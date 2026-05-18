import {
  type AnalyzerResult,
  buildResult,
  errorResult,
  initializeExtractionMaps,
  type Issue,
  type MarkFileContext,
  scanAndMarkFiles,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import type { VcpkgOptions, VcpkgTargetPlatform } from './options.ts';
import { basename, dirname, resolve } from 'path/posix';
import type { VcpkgDependencyObject, VcpkgIdentifier, VcpkgPort } from './types.ts';
import { matchesPlatform } from './platform.ts';
import { createVcpkgPurl, retrieveVcpkgReferenceLineNumber } from './utils';

type VcpkgPackageInfoResult = Record<string, VcpkgPort>;
type VcpkgPortVersionMap = Map<string, string>;

interface DependencyExtractionResult {
  portVersionMap: VcpkgPortVersionMap;
  dependencies: Record<string, string[]>;
  missingPorts: string[];
}

export async function markFiles(this: MarkFileContext, codebase: string, options: VcpkgOptions) {
  await scanAndMarkFiles(this, codebase, '**/vcpkg.json', options.ignore);
}

export async function extractFile(file: string, options: VcpkgOptions): Promise<AnalyzerResult> {
  // retrieve absolute path to ensure consistent behavior
  file = resolve(file);

  const vcpkgPath = options.vcpkgPath;
  const vcpkgContent = (await Bun.file(file).text()).replaceAll('\r\n', '\n');

  const { packageMap, relationshipsMap } = initializeExtractionMaps();

  try {
    const vcpkgJson = JSON.parse(vcpkgContent) as VcpkgPort;
    const vcpkgFileDir = dirname(file);

    // 1. Fetch dependencies
    let subprojectDeps = vcpkgJson.dependencies?.filter((dep) => filterByPlatform(dep, options.targetPlatform)) ?? [];
    const {
      portVersionMap,
      dependencies: portDeps,
      missingPorts,
    } = await loadTransitiveDependencies(
      subprojectDeps.map((dep) => (typeof dep === 'string' ? dep : dep.name)),
      vcpkgFileDir,
      vcpkgPath,
      options.targetPlatform,
    );

    const issues: Issue[] = missingPorts.map((missingPort) => ({
      severity: 'ERROR',
      file,
      message: `Could not retrieve information for dependency "${missingPort}". This package and its dependencies will be not be included in the results.`,
    }));

    // for consistent further processing, remove all missing ports from all dependencies (so these ports are not included at all in the result)
    subprojectDeps = subprojectDeps.filter((dep) => {
      const depName = typeof dep === 'string' ? dep : dep.name;
      return !missingPorts.includes(depName);
    });
    for (const key of Object.keys(portDeps)) {
      portDeps[key] = portDeps[key]?.filter((dep) => !missingPorts.includes(dep)) ?? [];
    }

    // 2. Convert format
    const subprojects: Subproject[] = [extractSubproject(vcpkgJson, subprojectDeps, portVersionMap, file)];

    for (const [packageName, deps] of Object.entries(portDeps)) {
      const version = portVersionMap.get(packageName);
      if (!version) {
        throw new Error(`Could not retrieve version for package "${packageName}".`);
      }

      // add package
      const purl = createVcpkgPurl(packageName, version, false);
      const evidence: Set<string> = new Set();
      if (subprojectDeps.some((dep) => (typeof dep === 'string' ? dep : dep.name) === packageName)) {
        const lineNumbers = retrieveVcpkgReferenceLineNumber(packageName, vcpkgContent);
        lineNumbers.map((num) => `${file}#${num + 1}`).forEach((src) => evidence.add(src));
      }

      packageMap.set(purl, {
        purl,
        evidence,
      });

      // add dependencies
      const depPurls = deps.map((dep) => {
        return portToPurl(dep, portVersionMap);
      });
      if (depPurls.length > 0) {
        relationshipsMap.set(purl, new Set(depPurls));
      }
    }

    return buildResult(packageMap, relationshipsMap, subprojects, issues);
  } catch (error) {
    return errorResult(
      file,
      file,
      `Failed to extract dependencies from ${file}: ${error instanceof Error ? `message: ${error.message}\n\nstack: ${error.stack}` : String(error)}`,
    );
  }
}

/**
 * Extracts a subproject with its host and target dependencies
 */
function extractSubproject(
  rootPort: VcpkgPort,
  firstLevelDeps: (string | VcpkgDependencyObject)[],
  portVersionMap: VcpkgPortVersionMap,
  vcpkgFilePath: string,
): Subproject {
  // group into host and target dependencies and convert to purls
  const { hostDeps, targetDeps } = firstLevelDeps.reduce(
    (acc, dep) => {
      const purl = portToPurl(dep, portVersionMap);
      const isHostDependency = typeof dep !== 'string' && dep.host;
      if (isHostDependency) {
        acc.hostDeps.push(purl);
      } else {
        acc.targetDeps.push(purl);
      }
      return acc;
    },
    {
      hostDeps: [] as string[],
      targetDeps: [] as string[],
    },
  );

  const subproject: Subproject = {
    purl: createVcpkgPurl(
      // name is not required for non-library ports, so fall back to directory name
      rootPort.name ?? basename(dirname(vcpkgFilePath)),
      portToVersion(rootPort) ?? 'unknown',
      true,
    ),
    definitionFile: vcpkgFilePath,
    scopes: [
      {
        scope: 'target',
        packages: targetDeps,
      },
      {
        scope: 'host',
        packages: hostDeps,
      },
    ],
  };

  return subproject;
}

function filterByPlatform(
  dependency: VcpkgIdentifier | VcpkgDependencyObject,
  targetPlatform?: VcpkgTargetPlatform,
): boolean {
  if (!targetPlatform) {
    // all platforms are included
    return true;
  }

  if (typeof dependency === 'string') {
    // if dependency is a string, it applies to all platforms
    return true;
  }

  if (!dependency.platform) {
    // if no platform field is specified, the dependency applies to all platforms
    return true;
  }

  // evaluate platform expression against target platform
  return matchesPlatform(dependency.platform, targetPlatform);
}

function extractAndFilterDependencies(port: VcpkgPort, targetPlatform?: VcpkgTargetPlatform): string[] {
  // TODO extract feature dependencies as well

  return (
    port.dependencies
      ?.filter((dep) => filterByPlatform(dep, targetPlatform))
      .map((dep) => {
        return typeof dep === 'string' ? dep : dep.name;
      }) || []
  );
}

/**
 * Load dependencies for the given root file and the given platform, including transitive dependencies.
 */
async function loadTransitiveDependencies(
  portsToLoad: string[],
  vcpkgFileDir: string,
  vcpkgPath: string,
  targetPlatform?: VcpkgTargetPlatform,
): Promise<DependencyExtractionResult> {
  const visited = new Set<string>();
  const portVersionMap: VcpkgPortVersionMap = new Map();
  const missingPorts: string[] = [];
  const dependencies: Record<string, string[]> = {};

  // start with all of the dependencies of the root file
  const queue: string[] = portsToLoad;

  // collect dependencies in a breadth-first manner
  while (queue.length > 0) {
    const packageInfos = await retrievePackageInfos(queue, vcpkgFileDir, vcpkgPath);
    const nextQueue: string[] = [];
    for (const packageName of queue) {
      if (!packageInfos[packageName]) {
        // could not retrieve information for this package, add it to missingPorts and skip it
        missingPorts.push(packageName);
      } else {
        // retrieve package info and add its dependencies to the queue
        const port = packageInfos[packageName];

        const version = portToVersion(port);
        if (port.name === undefined || version === undefined) {
          // Name has to be set for libraries and at least one version has to be set.
          // Therefore, this case should not happen at all!
          throw new Error(
            `Received invalid package info for "${packageName}": missing name or version. ` +
              `Full info: ${JSON.stringify(port)}`,
          );
        }
        portVersionMap.set(port.name, version);

        const deps = extractAndFilterDependencies(port, targetPlatform);
        dependencies[packageName] = deps;
        nextQueue.push(...deps.filter((dep) => !visited.has(dep)));
      }
      visited.add(packageName);
    }

    // clear queue and copy all elements from nextQueue to queue
    queue.splice(0, queue.length, ...nextQueue);
  }

  return { portVersionMap, dependencies, missingPorts };
}

async function retrievePackageInfos(
  packageNames: string[],
  vcpkgFileDir: string,
  vcpkgPath: string,
): Promise<VcpkgPackageInfoResult> {
  const cmd = [vcpkgPath, 'x-package-info', '--x-json', ...packageNames];
  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: vcpkgFileDir,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 1) {
    throw new Error(`"${cmd.join(' ')}" failed with exit code ${exitCode}: ${await proc.stderr.text()}`);
  }

  const parsed: VcpkgPackageInfoResult = (await proc.stdout.json()).results;
  return parsed;
}

function portToVersion(port: VcpkgPort): string | undefined {
  return port.version ?? port['version-date'] ?? port['version-semver'] ?? port['version-string'];
}

function portToPurl(port: string | VcpkgDependencyObject, portVersionMap: VcpkgPortVersionMap): string {
  const depName = typeof port === 'string' ? port : port.name;
  const version = portVersionMap.get(depName);
  if (!version) {
    throw new Error(
      `Could not retrieve version for dependency "${depName}". ` +
        `Full dependency info: ${JSON.stringify(port)}. Full port version map: ${JSON.stringify(Array.from(portVersionMap.entries()))}`,
    );
  }
  return createVcpkgPurl(depName, version, false);
}
