import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Issue,
  type Subproject,
  buildResult,
  ensurePackageExists,
  filesExtractor,
  initializeExtractionMaps,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path/posix";
import { parse as parseToml } from "smol-toml";
import { createPypiPurl, normalizePythonName, parsePythonDependencyName } from "../python-utils.ts";
import type { PythonOptions } from "../options.ts";
import { optionSchema } from "../options.ts";

const SUPPORTED_LOCKFILES = ["poetry.lock", "pdm.lock", "uv.lock", "Pipfile.lock"];

interface PyProjectToml {
  project?: {
    name?: string;
    version?: string;
    dependencies?: unknown;
    "optional-dependencies"?: Record<string, unknown>;
  };
  "dependency-groups"?: Record<string, unknown>;
  tool?: {
    poetry?: {
      name?: string;
      version?: string;
      dependencies?: Record<string, unknown>;
      "dev-dependencies"?: Record<string, unknown>;
      group?: Record<string, { dependencies?: Record<string, unknown> }>;
    };
    pdm?: {
      "dev-dependencies"?: Record<string, unknown>;
    };
    uv?: {
      "dev-dependencies"?: unknown;
    };
  };
}

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: "pyprojecttoml",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: PythonOptions) {
    await scanAndMarkFiles(this, codebase, "**/pyproject.toml", options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    if (await hasSupportedLockfile(dir)) {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: [],
      };
    }

    const content = await readNormalizedTextFile(file);
    const lines = content.split("\n");
    const pyproject = parseToml(content) as PyProjectToml;
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const scopePackages = new Map<string, Set<string>>();
    const issues: Issue[] = [];

    const addDependency = (scope: string, depName: string, evidenceValue: string) => {
      if (normalizePythonName(depName) === "python") return;

      const purl = createPypiPurl(depName);
      ensurePackageExists(packageMap, purl);
      packageMap
        .get(purl)!
        .evidence.add(toEvidence(file, findDependencyLineNumber(lines, depName, evidenceValue)));

      let packages = scopePackages.get(scope);
      if (!packages) {
        packages = new Set<string>();
        scopePackages.set(scope, packages);
      }
      packages.add(purl);
    };

    const addDependencySpec = (scope: string, spec: string) => {
      const depName = parsePythonDependencyName(spec);
      if (depName) {
        addDependency(scope, depName, spec);
      } else {
        issues.push({
          severity: "WARNING",
          message: `Unsupported pyproject.toml dependency declaration was not emitted: ${spec}`,
          file: toEvidence(file, findDependencyLineNumber(lines, spec, spec)),
        });
      }
    };

    for (const spec of asStringArray(pyproject.project?.dependencies)) {
      addDependencySpec("dependencies", spec);
    }

    for (const [extraName, specs] of Object.entries(
      pyproject.project?.["optional-dependencies"] || {},
    )) {
      for (const spec of asStringArray(specs)) {
        addDependencySpec(`optional.${extraName}`, spec);
      }
    }

    addPoetryDependencyTable(addDependency, "dependencies", pyproject.tool?.poetry?.dependencies);
    addPoetryDependencyTable(
      addDependency,
      "dev-dependencies",
      pyproject.tool?.poetry?.["dev-dependencies"],
    );

    for (const [groupName, group] of Object.entries(pyproject.tool?.poetry?.group || {})) {
      addPoetryDependencyTable(addDependency, `group.${groupName}`, group.dependencies);
    }

    for (const [groupName, specs] of Object.entries(
      pyproject.tool?.pdm?.["dev-dependencies"] || {},
    )) {
      const scope = groupName === "dev" ? "dev-dependencies" : `group.${groupName}`;
      for (const spec of asStringArray(specs)) {
        addDependencySpec(scope, spec);
      }
    }

    for (const spec of asStringArray(pyproject.tool?.uv?.["dev-dependencies"])) {
      addDependencySpec("dev-dependencies", spec);
    }

    for (const [groupName, specs] of Object.entries(pyproject["dependency-groups"] || {})) {
      const scope = groupName === "dev" ? "dev-dependencies" : `group.${groupName}`;
      for (const spec of asStringArray(specs)) {
        addDependencySpec(scope, spec);
      }
    }

    const scopes = toScopes(scopePackages);
    const subprojects: Subproject[] = [];
    if (scopes.length > 0) {
      subprojects.push({
        purl: createPypiPurl(
          getProjectName(pyproject, dir),
          pyproject.project?.version || pyproject.tool?.poetry?.version || null,
        ),
        definitionFile: file,
        scopes,
      });
    }

    if (scopes.length > 0) {
      issues.push({
        severity: "WARNING",
        message:
          "pyproject.toml dependencies are unresolved and emitted as versionless PyPI PURLs because no supported Python lockfile was found. Use a lockfile for resolved versions and transitive relationships.",
        file,
      });
    }

    return buildResult(packageMap, relationshipsMap, subprojects, issues);
  },
});

function addPoetryDependencyTable(
  addDependency: (scope: string, depName: string, evidenceValue: string) => void,
  scope: string,
  dependencies?: Record<string, unknown>,
): void {
  if (!dependencies) return;

  for (const depName of Object.keys(dependencies)) {
    addDependency(scope, depName, depName);
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toScopes(scopePackages: Map<string, Set<string>>): DependencyScope[] {
  return Array.from(scopePackages.entries()).map(([scope, packages]) => ({
    scope,
    packages: Array.from(packages),
  }));
}

function getProjectName(pyproject: PyProjectToml, dir: string): string {
  return pyproject.project?.name || pyproject.tool?.poetry?.name || basename(dir) || "unknown";
}

function findDependencyLineNumber(
  lines: string[],
  depName: string,
  evidenceValue: string,
): number | undefined {
  const normalizedDepName = normalizePythonName(depName);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    if (trimmed.includes(`"${evidenceValue}"`) || trimmed.includes(`'${evidenceValue}'`)) {
      return i + 1;
    }

    const keyMatch = trimmed.match(/^["']?([a-zA-Z0-9_.-]+)["']?\s*=/);
    if (keyMatch && normalizePythonName(keyMatch[1]) === normalizedDepName) {
      return i + 1;
    }

    const stringMatch = trimmed.match(/^["']([^"']+)["']/);
    const dependencyName = stringMatch ? parsePythonDependencyName(stringMatch[1]) : null;
    if (dependencyName && normalizePythonName(dependencyName) === normalizedDepName) {
      return i + 1;
    }
  }

  return undefined;
}

function toEvidence(file: string, lineNumber?: number): string {
  return lineNumber === undefined ? file : `${file}#${lineNumber}`;
}

async function hasSupportedLockfile(dir: string): Promise<boolean> {
  for (const lockfile of SUPPORTED_LOCKFILES) {
    if (await pathExists(join(dir, lockfile))) {
      return true;
    }
  }
  return false;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
