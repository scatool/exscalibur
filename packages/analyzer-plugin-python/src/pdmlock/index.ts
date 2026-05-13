import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  addRelationship,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { basename, dirname, join } from 'node:path/posix';
import { parse as parseToml } from 'smol-toml';
import { createPypiPurl, findTomlPackageLineNumber, normalizePythonName } from '../python-utils.ts';
import type { PythonOptions } from '../options.ts';
import { optionSchema } from '../options.ts';

interface PdmLock {
  package?: PackageEntry[];
  metadata?: {
    'lock-version'?: string;
    'content-hash'?: string;
    groups?: string[];
  };
}

interface PackageEntry {
  name: string;
  version: string;
  requires_python?: string;
  dependencies?: string[];
  'requires-python'?: string;
  summary?: string;
  groups?: string[];
}

interface PyProjectToml {
  project?: {
    name?: string;
    version?: string;
    dependencies?: string[];
  };
  tool?: {
    pdm?: {
      'dev-dependencies'?: Record<string, string[]>;
    };
  };
}

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: 'pdmlock',
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: PythonOptions) {
    await scanAndMarkFiles(this, codebase, '**/pdm.lock', options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = (await Bun.file(file).text()).replaceAll('\r\n', '\n');
    const dir = dirname(file);
    const lines = content.split('\n');

    const lockfile = parseToml(content) as PdmLock;
    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    const subprojects: Subproject[] = [];

    // Try to read pyproject.toml to get project info
    const pyprojectPath = join(dir, 'pyproject.toml');
    let projectName: string | null = null;
    let projectVersion = '0.0.0';
    let pyprojectToml: PyProjectToml | null = null;

    try {
      const pyprojectContent = await Bun.file(pyprojectPath).text();
      pyprojectToml = parseToml(pyprojectContent) as PyProjectToml;

      if (pyprojectToml.project?.name) {
        projectName = pyprojectToml.project.name;
      }
      if (pyprojectToml.project?.version) {
        projectVersion = pyprojectToml.project.version;
      }
    } catch {
      // pyproject.toml doesn't exist or is unreadable
    }

    // Fallback to directory name if no project name found
    if (!projectName) {
      projectName = basename(dir) || 'unknown';
    }

    // Build a map of all packages with their resolved versions
    const packageVersionMap = new Map<string, string>();
    const packageGroupMap = new Map<string, string[]>();

    // Process all packages in the lockfile
    if (lockfile.package) {
      for (const pkg of lockfile.package) {
        const normalizedName = normalizePythonName(pkg.name);
        packageVersionMap.set(normalizedName, pkg.version);
        if (pkg.groups) {
          packageGroupMap.set(normalizedName, pkg.groups);
        }

        const purl = createPypiPurl(pkg.name, pkg.version);
        ensurePackageExists(packageMap, purl);

        // Find line number for this package
        const lineNumber = findTomlPackageLineNumber(lines, pkg.name);
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Add relationships to dependencies
        if (pkg.dependencies) {
          for (const depSpec of pkg.dependencies) {
            // Parse dependency specification (e.g., "requests>=2.0.0" or "requests")
            const depName = parseDependencyName(depSpec);
            if (!depName) continue;

            const normalizedDepName = normalizePythonName(depName);
            const depVersion = packageVersionMap.get(normalizedDepName);
            if (depVersion) {
              const depPurl = createPypiPurl(depName, depVersion);
              addRelationship(relationshipsMap, purl, depPurl);
              ensurePackageExists(packageMap, depPurl);
            }
          }
        }
      }
    }

    // Create subproject with dependency scopes
    const scopes: DependencyScope[] = [];

    // Main dependencies from pyproject.toml
    if (pyprojectToml?.project?.dependencies) {
      const packages: string[] = [];
      for (const depSpec of pyprojectToml.project.dependencies) {
        const depName = parseDependencyName(depSpec);
        if (!depName) continue;

        const normalizedName = normalizePythonName(depName);
        const version = packageVersionMap.get(normalizedName);
        if (version) {
          packages.push(createPypiPurl(depName, version));
        }
      }

      if (packages.length > 0) {
        scopes.push({
          scope: 'dependencies',
          packages,
        });
      }
    }

    // Dev dependencies from pyproject.toml
    if (pyprojectToml?.tool?.pdm?.['dev-dependencies']) {
      for (const [groupName, deps] of Object.entries(pyprojectToml.tool.pdm['dev-dependencies'])) {
        const packages: string[] = [];
        for (const depSpec of deps) {
          const depName = parseDependencyName(depSpec);
          if (!depName) continue;

          const normalizedName = normalizePythonName(depName);
          const version = packageVersionMap.get(normalizedName);
          if (version) {
            packages.push(createPypiPurl(depName, version));
          }
        }

        if (packages.length > 0) {
          scopes.push({
            scope: groupName === 'dev' ? 'dev-dependencies' : `group.${groupName}`,
            packages,
          });
        }
      }
    }

    // Fallback: categorize by groups in lockfile
    if (scopes.length === 0 && lockfile.package) {
      const groupedPackages = new Map<string, string[]>();

      for (const pkg of lockfile.package) {
        const purl = createPypiPurl(pkg.name, pkg.version);
        const groups = pkg.groups || ['default'];

        for (const group of groups) {
          if (!groupedPackages.has(group)) {
            groupedPackages.set(group, []);
          }
          groupedPackages.get(group)!.push(purl);
        }
      }

      for (const [groupName, packages] of groupedPackages) {
        if (packages.length > 0) {
          scopes.push({
            scope: groupName === 'default' ? 'dependencies' : `group.${groupName}`,
            packages,
          });
        }
      }
    }

    if (scopes.length > 0) {
      const projectPurl = createPypiPurl(projectName, projectVersion);
      subprojects.push({
        purl: projectPurl,
        definitionFile: pyprojectPath,
        scopes,
      });
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
  },
});

/**
 * Parse dependency name from a specification string
 * Examples: "requests>=2.0.0" -> "requests", "django" -> "django"
 */
function parseDependencyName(spec: string): string | null {
  spec = spec.trim();
  if (!spec) return null;

  // Split on operators: >=, <=, ==, !=, ~=, <, >, [
  const match = spec.match(/^([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
