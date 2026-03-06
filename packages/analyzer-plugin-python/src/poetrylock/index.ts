import {
  type AnalyzerResult,
  type DependencyScope,
  type Extractor,
  type Subproject,
  filesExtractor,
  addRelationship,
  ensurePackageExists,
  convertPackageMapToArray,
  convertRelationshipsMapToArray,
  initializeExtractionMaps,
  scanAndMarkFiles,
} from '@scatool/analyzer-core/src/index.ts';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { createPypiPurl, findTomlPackageLineNumber, normalizePythonName } from '../python-utils.ts';
import type { PythonOptions } from '../options.ts';

interface PoetryLock {
  package?: PackageEntry[];
  metadata?: {
    'lock-version'?: string;
    'python-versions'?: string;
    'content-hash'?: string;
  };
}

interface PackageEntry {
  name: string;
  version: string;
  description?: string;
  category?: string;
  optional?: boolean;
  'python-versions'?: string;
  dependencies?: Record<string, string | DependencySpec>;
  extras?: Record<string, string[]>;
  source?: {
    type: string;
    url?: string;
    reference?: string;
  };
}

interface DependencySpec {
  version?: string;
  markers?: string;
  extras?: string[];
  optional?: boolean;
}

interface PyProjectToml {
  tool?: {
    poetry?: {
      name?: string;
      version?: string;
      dependencies?: Record<string, string | DependencySpec>;
      'dev-dependencies'?: Record<string, string | DependencySpec>;
      group?: Record<string, { dependencies?: Record<string, string | DependencySpec> }>;
    };
  };
}

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: 'poetrylock',
  version: 1,
  options: async () => ({
    ignore: ['**/.venv/**', '**/venv/**', '**/__pycache__/**'],
  }),
  markFiles: async function (codebase: string, options: PythonOptions) {
    await scanAndMarkFiles(this, codebase, '**/poetry.lock', options.ignore ?? []);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    const dir = dirname(file);
    const lines = content.split('\n');

    const lockfile = parseToml(content) as PoetryLock;
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

      if (pyprojectToml.tool?.poetry?.name) {
        projectName = pyprojectToml.tool.poetry.name;
      }
      if (pyprojectToml.tool?.poetry?.version) {
        projectVersion = pyprojectToml.tool.poetry.version;
      }
    } catch {
      // pyproject.toml doesn't exist or is unreadable
    }

    // Fallback to directory name if no project name found
    if (!projectName) {
      projectName = dirname(file).split('/').pop() || 'unknown';
    }

    // Build a map of all packages with their resolved versions
    const packageVersionMap = new Map<string, string>();
    const packageCategoryMap = new Map<string, string>();

    // Process all packages in the lockfile
    if (lockfile.package) {
      for (const pkg of lockfile.package) {
        const normalizedName = normalizePythonName(pkg.name);
        packageVersionMap.set(normalizedName, pkg.version);
        packageCategoryMap.set(normalizedName, pkg.category || 'main');

        const purl = createPypiPurl(pkg.name, pkg.version);
        ensurePackageExists(packageMap, purl);

        // Find line number for this package
        const lineNumber = findTomlPackageLineNumber(lines, pkg.name);
        if (lineNumber !== undefined) {
          packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
        }

        // Add relationships to dependencies
        if (pkg.dependencies) {
          for (const depName of Object.keys(pkg.dependencies)) {
            // Skip python itself
            if (depName.toLowerCase() === 'python') continue;

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

    // Create subproject with dependency scopes based on pyproject.toml
    const scopes: DependencyScope[] = [];

    if (pyprojectToml?.tool?.poetry?.dependencies) {
      const packages: string[] = [];
      for (const name of Object.keys(pyprojectToml.tool.poetry.dependencies)) {
        // Skip python itself
        if (name.toLowerCase() === 'python') continue;

        const normalizedName = normalizePythonName(name);
        const version = packageVersionMap.get(normalizedName);
        if (version) {
          packages.push(createPypiPurl(name, version));
        }
      }

      if (packages.length > 0) {
        scopes.push({
          scope: 'dependencies',
          packages,
        });
      }
    }

    // Handle dev-dependencies (legacy format)
    if (pyprojectToml?.tool?.poetry?.['dev-dependencies']) {
      const packages: string[] = [];
      for (const name of Object.keys(pyprojectToml.tool.poetry['dev-dependencies'])) {
        const normalizedName = normalizePythonName(name);
        const version = packageVersionMap.get(normalizedName);
        if (version) {
          packages.push(createPypiPurl(name, version));
        }
      }

      if (packages.length > 0) {
        scopes.push({
          scope: 'dev-dependencies',
          packages,
        });
      }
    }

    // Handle dependency groups (modern format)
    if (pyprojectToml?.tool?.poetry?.group) {
      for (const [groupName, group] of Object.entries(pyprojectToml.tool.poetry.group)) {
        if (group.dependencies) {
          const packages: string[] = [];
          for (const name of Object.keys(group.dependencies)) {
            const normalizedName = normalizePythonName(name);
            const version = packageVersionMap.get(normalizedName);
            if (version) {
              packages.push(createPypiPurl(name, version));
            }
          }

          if (packages.length > 0) {
            scopes.push({
              scope: `group.${groupName}`,
              packages,
            });
          }
        }
      }
    }

    // Fallback: if no pyproject.toml, categorize by package category
    if (scopes.length === 0 && lockfile.package) {
      const mainPackages: string[] = [];
      const devPackages: string[] = [];

      for (const pkg of lockfile.package) {
        const purl = createPypiPurl(pkg.name, pkg.version);
        const category = pkg.category || 'main';

        if (category === 'dev') {
          devPackages.push(purl);
        } else {
          mainPackages.push(purl);
        }
      }

      if (mainPackages.length > 0) {
        scopes.push({ scope: 'dependencies', packages: mainPackages });
      }
      if (devPackages.length > 0) {
        scopes.push({ scope: 'dev-dependencies', packages: devPackages });
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

    const packages = convertPackageMapToArray(packageMap);
    const relationships = convertRelationshipsMapToArray(relationshipsMap);

    return {
      packages,
      subprojects,
      relationships,
      issues: [],
    };
  },
});
