import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Issue,
  type Subproject,
  filesExtractor,
  addRelationship,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
  readNormalizedTextFile,
  readTextFile,
  scanAndMarkFiles,
  scanFiles,
} from "@scatool/analyzer-core";
import { basename, dirname, join } from "node:path/posix";
import { parse as parseToml } from "smol-toml";
import {
  PYLOCK_FILE_NAME,
  createPypiPurl,
  normalizePythonName,
  parsePythonDependencyName,
} from "../python-utils.ts";
import type { PythonOptions } from "../options.ts";
import { optionSchema } from "../options.ts";

/**
 * Root of a pylock.toml file.
 * Modeled after the official spec: https://packaging.python.org/en/latest/specifications/pylock-toml
 */
interface PyLock {
  "lock-version": string;
  environments?: string[];
  "requires-python"?: string;
  extras?: string[];
  "dependency-groups"?: string[];
  "default-groups"?: string[];
  "created-by": string;
  packages: PackagesEntry[];
  tool?: Record<string, unknown>;
}

/** One [[packages]] entry. */
interface PackagesEntry {
  name: string;
  version?: string;
  marker?: string;
  "requires-python"?: string;
  dependencies?: PackagesDependency[];
  vcs?: PackagesVCS;
  directory?: PackagesDirectory;
  archive?: PackagesArchive;
  index?: string;
  sdist?: PackagesSdist;
  wheels?: PackagesWheel[];
  "attestation-identities"?: PackagesAttestationIdentity[];
  tool?: Record<string, unknown>;
}

/**
 * One [[packages.dependencies]] entry.
 * Minimally-identifying subset of a [[packages]] entry.
 */
type PackagesDependency = Partial<PackagesEntry>;

interface PackagesVCS {
  type: string;
  url?: string;
  path?: string;
  "requested-revision"?: string;
  "commit-id": string;
  subdirectory?: string;
}

interface PackagesDirectory {
  path: string;
  editable?: boolean;
  subdirectory?: string;
}

/** Fields shared by archive, sdist and wheels entries. */
interface PackagesFile {
  url?: string;
  path?: string;
  size?: number; // integer per spec
  "upload-time"?: Date;
  hashes: Record<string, string>; // algorithm -> digest, e.g. { sha256: "..." }
}

interface PackagesArchive extends PackagesFile {
  subdirectory?: string;
}

interface PackagesSdist extends PackagesFile {
  name?: string;
}

interface PackagesWheel extends PackagesFile {
  name?: string;
}

interface PackagesAttestationIdentity {
  kind: string;
  [key: string]: unknown;
}

/** Root of a pyproject.toml file. */
interface PyProject {
  project?: {
    name?: string;
    version?: string;
    dynamic?: string[];
    "requires-python"?: string;
    dependencies?: string[];
    "optional-dependencies"?: Record<string, string[]>;
  };
  tool?: {
    hatch?: {
      envs?: Record<string, HatchEnv>; // [tool.hatch.envs.<name>]
    };
    // ... possibly more tools besides Hatch that generate pylock.toml files
  };
}

/** [tool.hatch.envs.<name>] entry. */
interface HatchEnv {
  template?: string;
  detached?: boolean;
  dependencies?: string[];
  "extra-dependencies"?: string[];
  features?: string[];
  locked?: boolean;
  locker?: string;
  installer?: string;
  "lock-filename"?: string;
}

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: "pylock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: PythonOptions) {
    // Spec file names: pylock.toml or pylock.<name>.toml
    // Mark one lockfile per directory: extractFile processes all sibling lockfiles at once, to avoid duplicate subprojects
    const found: string[] = []; // all files matching the globs below
    const collector = { ...this, markFile: (file: string) => void found.push(file) };
    await scanAndMarkFiles(collector, codebase, "**/pylock.toml", options.ignore);
    await scanAndMarkFiles(collector, codebase, "**/pylock.*.toml", options.ignore);

    const byDir = new Map<string, string>(); // holds one lockfile per directory, siblings excluded (discovered by extractFile though)
    for (const file of found.sort()) {
      // The globs are broader than the spec, e.g. they also match pylock.a.b.toml
      if (!PYLOCK_FILE_NAME.test(basename(file))) continue;
      if (!byDir.has(dirname(file))) byDir.set(dirname(file), file);
    }
    for (const file of byDir.values()) this.markFile(file);
  },
  extractFile: async (file: string, options: PythonOptions): Promise<AnalyzerResult> => {
    const dir = dirname(file);
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];
    const issues: Issue[] = [];

    // Try to read pyproject.toml to get project info
    const pyprojectPath = join(dir, "pyproject.toml");
    let pyproject: PyProject | null = null;
    try {
      pyproject = parseToml(await readTextFile(pyprojectPath)) as PyProject;
    } catch {
      // pyproject.toml doesn't exist or is unreadable
    }

    // Fallback to directory name if no project name found
    const projectName = pyproject?.project?.name || basename(dir) || "unknown";
    const projectVersion = pyproject?.project?.version ?? null;

    // process all (potentially existing) sibling lockfiles of this lockfile
    const lockfiles = [
      ...(await scanFiles(dir, "pylock.toml", options.ignore)),
      ...(await scanFiles(dir, "pylock.*.toml", options.ignore)),
    ].filter((lockfilePath) => PYLOCK_FILE_NAME.test(basename(lockfilePath)));

    // Scope name -> purls, merged across all lockfiles
    const scopeMap = new Map<string, Set<string>>();
    const addToScope = (scope: string, purls: string[]): void => {
      if (purls.length === 0) return;
      const existing = scopeMap.get(scope) ?? new Set<string>();
      for (const purl of purls) existing.add(purl);
      scopeMap.set(scope, existing);
    };
    // All purls from all lockfiles, for the fallback scope
    const allPurls = new Set<string>();

    for (const lockfilePath of lockfiles) {
      let content: string;
      let lockfile: PyLock;
      try {
        content = await readNormalizedTextFile(lockfilePath);
        lockfile = parseToml(content) as unknown as PyLock; // "as unknown" needed for tsc to succeed
      } catch (error) {
        // Keep extracting the remaining lockfiles of this project
        issues.push({
          code: "pylock.parse_failed",
          severity: "ERROR",
          message: `Failed to parse lockfile: ${error instanceof Error ? error.message : String(error)}`,
          file: lockfilePath,
        });
        continue;
      }

      const packages = lockfile.packages ?? [];
      // Validate required fields before adding anything, so a malformed lockfile neither aborts its siblings nor leaves partial results
      if (!Array.isArray(packages) || packages.some((pkg) => typeof pkg?.name !== "string")) {
        issues.push({
          code: "pylock.invalid_lockfile",
          severity: "ERROR",
          message: "Lockfile has no [[packages]] array or a [[packages]] entry without a name",
          file: lockfilePath,
        });
        continue;
      }
      const packageLines = findPackageLineNumbers(content.split("\n"));

      // Set of all purls given by the packages and their versions
      const purls = packages.map((pkg) => createPypiPurl(pkg.name, pkg.version));
      // Map of each normalized name to all of its purls in this lockfile (since a name can appear multiple times)
      const purlsByName = new Map<string, string[]>();

      // Process all packages in the lockfile
      packages.forEach((pkg, index) => {
        const purl = purls[index]!;
        ensurePackageExists(packageMap, purl);
        allPurls.add(purl);

        // Build purlsByName map
        const normalizedName = normalizePythonName(pkg.name);
        const existing = purlsByName.get(normalizedName) ?? [];
        if (!existing.includes(purl)) existing.push(purl);
        purlsByName.set(normalizedName, existing);

        const lineNumber = packageLines[index];
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${lockfilePath}#${lineNumber}`);
        }
      });

      // Add relationships: each dependency entry identifies exactly one other package entry by key-by-key comparison
      packages.forEach((pkg, index) => {
        for (const dependency of pkg.dependencies ?? []) {
          // Set of packages that the dependency relates to
          const matches = packages
            .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
            .filter(({ candidate }) => matchesDependency(candidate, dependency));

          if (matches.length === 1) {
            addRelationship(relationshipsMap, purls[index]!, purls[matches[0]!.candidateIndex]!);
          } else {
            issues.push({
              code: "pylock.unresolved_dependency",
              severity: "WARNING",
              message: `Dependency ${JSON.stringify(dependency)} of ${pkg.name} matches ${matches.length} package entries`,
              file: lockfilePath,
            });
          }
        }
      });

      // Resolve dependency specs against the packages of this lockfile
      const resolveSpecs = (specs: string[]): string[] => {
        const resolved = new Set<string>();
        for (const spec of specs) {
          const name = parsePythonDependencyName(spec);
          if (!name) continue;
          for (const purl of purlsByName.get(normalizePythonName(name)) ?? []) {
            resolved.add(purl);
          }
        }
        return Array.from(resolved);
      };

      const envName = findHatchEnvName(lockfilePath, pyproject);
      const env = envName ? pyproject?.tool?.hatch?.envs?.[envName] : undefined;

      // Project dependencies, unless the env doesn't install the project
      if (!env?.detached && pyproject?.project?.dependencies) {
        addToScope("dependencies", resolveSpecs(pyproject.project.dependencies));
      }

      // Dependencies of the Hatch environment this lockfile belongs to
      if (envName && env) {
        addToScope(
          `env.${envName}`,
          resolveSpecs([...(env.dependencies ?? []), ...(env["extra-dependencies"] ?? [])]),
        );
      }
    }

    // Fallback: if nothing could be resolved, put all packages in one scope
    if (scopeMap.size === 0) {
      addToScope("dependencies", Array.from(allPurls));
    }

    const scopes: DependencyScope[] = Array.from(scopeMap, ([scope, purls]) => ({
      scope,
      packages: Array.from(purls),
    }));

    if (scopes.length > 0) {
      subprojects.push({
        purl: createPypiPurl(projectName, projectVersion),
        // Fall back to the lockfile if pyproject.toml is missing
        definitionFile: pyproject ? pyprojectPath : (lockfiles[0] ?? file),
        scopes,
      });
    }

    return buildResult(packageMap, relationshipsMap, subprojects, issues);
  },
});

/**
 * Map a lock file to its Hatch environment.
 * Either an explicit `lock-filename` is given in pyproject.toml and returned,
 * otherwise filenames pylock.toml return "default" and pylock.<env>.toml return <env>.
 */
function findHatchEnvName(file: string, pyproject: PyProject | null): string | undefined {
  const fileName = basename(file);
  const envs = pyproject?.tool?.hatch?.envs ?? {};

  for (const [name, env] of Object.entries(envs)) {
    if (env["lock-filename"] && basename(env["lock-filename"]) === fileName) {
      return name;
    }
  }

  if (fileName === "pylock.toml") return "default";
  return fileName.match(PYLOCK_FILE_NAME)?.[1]?.slice(0, -1); // strip the trailing dot of "<name>."
}

/**
 * Line number of each [[packages]] entry's `name` key, by package index.
 * Skips `name` keys of sub-tables like [[packages.dependencies]].
 * Avoids using the first `name = "package-name"` match, since this pattern can occur several times for the same name
 * in different tables.
 */
function findPackageLineNumbers(lines: string[]): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  let inPackageTable = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    if (trimmed.startsWith("[")) {
      inPackageTable = trimmed === "[[packages]]";
      if (inPackageTable) result.push(undefined);
      continue;
    }

    if (inPackageTable && result[result.length - 1] === undefined && /^name\s*=/.test(trimmed)) {
      result[result.length - 1] = i + 1;
    }
  }

  return result;
}

/**
 * Checks whether a dependency can be mapped to exactly one candidate (package entry).
 * True if every key set in `dependency` equals the same key in `candidate`.
 */
function matchesDependency(candidate: PackagesEntry, dependency: PackagesDependency): boolean {
  return Object.entries(dependency).every(([key, value]) => {
    const candidateValue = candidate[key as keyof PackagesEntry];
    if (key === "name" && typeof value === "string" && typeof candidateValue === "string") {
      return normalizePythonName(value) === normalizePythonName(candidateValue);
    }
    return isSubset(value, candidateValue);
  });
}

/** Deep comparison where `expected` may set fewer object keys than `actual`. */
function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected instanceof Date && actual instanceof Date) {
    return expected.getTime() === actual.getTime();
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, i) => isSubset(item, actual[i]))
    );
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null) return false;
    return Object.entries(expected).every(([key, value]) =>
      isSubset(value, (actual as Record<string, unknown>)[key]),
    );
  }
  return expected === actual;
}
