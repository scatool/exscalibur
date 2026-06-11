import {
  type AnalyzerResult,
  buildResult,
  errorResult,
  findExecutable,
  initializeExtractionMaps,
  type MarkFileContext,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type Subproject,
} from "@scatool/analyzer-core";
import type { VcpkgOptions, VcpkgTargetPlatform } from "./options.ts";
import { basename, dirname } from "path/posix";
import { resolve } from "path";
import type {
  VcpkgDependencyFeatureObject,
  VcpkgDependencyObject,
  VcpkgIdentifier,
  VcpkgPort,
} from "./types.ts";
import { matchesPlatform } from "./platform.ts";
import { createVcpkgPurl, retrieveVcpkgReferenceLineNumber } from "./utils.ts";
import { retrievePortInfo } from "./portInfo.ts";
import { existsSync } from "node:fs";

export type VcpkgPortInstance = {
  port: VcpkgPort;
  features: Set<string>;
  dependencies: Map<string, VcpkgPortInstanceDependency>;
  defaultFeatures: boolean;
};
export type VcpkgPortInstanceDependency = {
  features: Set<string>;
  defaultFeatures: boolean;
  host: boolean;
};
export type VcpkgPortMap = Map<string, VcpkgPortInstance>;
type VcpkgPendingPort = {
  /**
   * Name of the port that should be included/fetched as a dependency
   */
  name: string;
  /**
   * List of features that should be enabled for this port
   */
  features: Set<string>;
  /**
   * Flag indicating, whether all default features should be enabled for this port
   */
  defaultFeatures: boolean;
  /**
   * Flag indicating if the port was fetched in this iteration and requires post-processing (default: false).
   *
   * Post processing includes:
   * 1. Extract non-feature dependencies of this port
   * 2. Extract and request all features if `includeAllFeatures` is set
   */
  postFetchDependencies?: boolean;

  /**
   * Set to true if this port is required as a host dependency, false or undefined if it is only required as a target dependency.
   */
  isHostDependency?: boolean;
};

export async function markFiles(this: MarkFileContext, codebase: string, options: VcpkgOptions) {
  await scanAndMarkFiles(this, codebase, "**/vcpkg.json", options.ignore);
}

export async function extractFile(file: string, options: VcpkgOptions): Promise<AnalyzerResult> {
  // retrieve absolute path to ensure consistent behavior
  // note: using non-posix resolve is important here, because else on
  // Windows the following will happen: resolve('C:\\path') === '/Users/cwd/C:/path'
  file = resolve(file).replaceAll("\\", "/");

  const vcpkgContent = await readNormalizedTextFile(file);
  const { packageMap, relationshipsMap } = initializeExtractionMaps();

  try {
    const vcpkgJson = JSON.parse(vcpkgContent) as VcpkgPort;
    const vcpkgFileDir = dirname(file);

    // 1. Fetch dependencies
    const { ports, rootPort, missingPorts } = await loadTransitiveDependencies(
      vcpkgJson,
      vcpkgFileDir,
      options,
    );
    if (missingPorts.size > 0) {
      throw new Error(
        `Failed to retrieve information for the following ports: ${[...missingPorts].join(", ")}. ` +
          `Did you set up the vcpkg registry correctly by cloning a recent version of the whole vcpkg repository (no --depth when cloning)?`,
      );
    }

    // 2. Convert format
    const subprojects: Subproject[] = [extractSubproject(rootPort, ports, file)];

    for (const [packageName, portInfo] of ports.entries()) {
      const version = portToVersion(portInfo.port);
      if (!version) {
        throw new Error(`Could not retrieve version for package "${packageName}".`);
      }

      // add package
      const purl = createVcpkgPurl(packageName, version, false);
      const evidence: Set<string> = new Set();
      if (rootPort.dependencies.keys().some((dep) => dep === packageName)) {
        // first-level dependency, add line number reference to evidence
        const lineNumbers = retrieveVcpkgReferenceLineNumber(packageName, vcpkgContent);
        lineNumbers.map((num) => `${file}#${num + 1}`).forEach((src) => evidence.add(src));
      }

      packageMap.set(purl, {
        purl,
        evidence,
      });

      // add dependencies
      const depPurls = portInfo.dependencies
        .keys()
        .map((depName) => {
          const depInfo = ports.get(depName)!;
          return portInstanceToPurl(depInfo);
        })
        .toArray();
      if (depPurls.length > 0) {
        relationshipsMap.set(purl, new Set(depPurls));
      }
    }

    return buildResult(packageMap, relationshipsMap, subprojects);
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
  rootPort: VcpkgPortInstance,
  ports: VcpkgPortMap,
  vcpkgFilePath: string,
): Subproject {
  const firstLevelDeps = rootPort.dependencies
    .entries()
    .map(([depName, dep]) => ({ depInfo: ports.get(depName)!, host: dep.host }));

  // group into host and target dependencies and convert to purls
  const { hostDeps, targetDeps } = firstLevelDeps.reduce(
    (acc, { depInfo, host }) => {
      const purl = portInstanceToPurl(depInfo);
      if (host) {
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
      rootPort.port.name ?? basename(dirname(vcpkgFilePath)),
      portToVersion(rootPort.port) ?? "unknown",
      true,
    ),
    definitionFile: vcpkgFilePath,
    scopes: [
      {
        scope: "target",
        packages: targetDeps,
      },
      {
        scope: "host",
        packages: hostDeps,
      },
    ],
  };

  return subproject;
}

function filterByPlatform(
  dependency: VcpkgIdentifier | VcpkgDependencyObject | VcpkgDependencyFeatureObject,
  targetPlatform?: VcpkgTargetPlatform,
): boolean {
  if (typeof dependency === "string") {
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

function collectFeatureDependencies(
  port: VcpkgPortInstance,
  features: Set<string>,
  targetPlatform: VcpkgTargetPlatform | undefined,
): VcpkgPendingPort[] {
  if (features.size === 0) {
    return [];
  }

  if (port.port.features === undefined) {
    throw new Error(
      `Port "${port.port.name}" does not have any features, but requested features are: ${Array.from(features).join(", ")}`,
    );
  }

  return Object.entries(port.port.features)
    .filter(([featureName]) => features.has(featureName))
    .flatMap(([, featureDef]) => {
      if (
        featureDef.supports !== undefined &&
        !matchesPlatform(featureDef.supports, targetPlatform)
      ) {
        // feature does not apply to the target platform, skip
        return [];
      }

      const featureDeps =
        featureDef.dependencies
          ?.filter((dep) => filterByPlatform(dep, targetPlatform))
          .map((dep) => {
            const depName = typeof dep === "string" ? dep : dep.name;
            const defaultFeatures =
              typeof dep === "string" ||
              dep["default-features"] === undefined ||
              dep["default-features"] === true;
            const isHostDependency = typeof dep !== "string" && dep.host === true;
            const depFeatures = new Set<string>();

            if (typeof dep !== "string" && dep.features) {
              // collect all features of this dependency that apply to the target platform
              for (const feat of dep.features) {
                const featName = typeof feat === "string" ? feat : feat.name;
                if (filterByPlatform(feat, targetPlatform)) {
                  depFeatures.add(featName);
                }
              }
            }

            return {
              name: depName,
              features: depFeatures,
              defaultFeatures,
              isHostDependency,
            } as VcpkgPendingPort;
          }) ?? [];

      return featureDeps;
    });
}

function collectNonFeatureDependencies(
  port: VcpkgPortInstance,
  options: VcpkgOptions,
): VcpkgPendingPort[] {
  return (
    port.port.dependencies
      ?.filter((dep) => filterByPlatform(dep, options.targetPlatform))
      .map((dep) => {
        const depName = typeof dep === "string" ? dep : dep.name;
        const defaultFeatures =
          typeof dep === "string" ||
          dep["default-features"] === undefined ||
          dep["default-features"] === true;
        const isHostDependency = typeof dep !== "string" && dep.host === true;
        const features = new Set();

        if (typeof dep !== "string" && dep.features) {
          for (const feature of dep.features) {
            if (options.includeAllFeatures || filterByPlatform(feature, options.targetPlatform)) {
              // include feature
              features.add(feature);
            }
          }
        }

        return { name: depName, features, defaultFeatures, isHostDependency } as VcpkgPendingPort;
      }) ?? []
  );
}

function createChangedPendingPortFilter(
  ports: VcpkgPortMap,
): (pending: VcpkgPendingPort) => boolean {
  return (pending: VcpkgPendingPort) => {
    const portInfo = ports.get(pending.name);

    if (!portInfo) {
      // port is not loaded yet, keep pending request to fetch it
      return true;
    }

    if (pending.defaultFeatures && !portInfo.defaultFeatures) {
      // default features should be enabled for this port, but are currently not
      return true;
    }

    const currentFeatures = portInfo.features;
    const requestedFeatures = pending.features;

    if (requestedFeatures.difference(currentFeatures).size > 0) {
      // there are features that should be enabled for this port, but are currently not
      return true;
    }

    // no need to keep this pending request, as the port is already loaded and has all required features enabled
    return false;
  };
}

function updatePortDependenciesFromPending(portInfo: VcpkgPortInstance, pending: VcpkgPendingPort) {
  if (portInfo.port.name === pending.name) {
    // ignore self dependency
    return;
  }

  if (!portInfo.dependencies.has(pending.name)) {
    portInfo.dependencies.set(pending.name, {
      features: new Set(),
      defaultFeatures: false,
      host: pending.isHostDependency ?? false,
    });
  }

  const depInfo = portInfo.dependencies.get(pending.name)!;
  depInfo.defaultFeatures = depInfo.defaultFeatures || pending.defaultFeatures;
  pending.features.forEach((feat) => depInfo.features.add(feat));
}

/**
 * Load all VcpkgPorts for the given root dependencies and their transitive dependencies.
 * Returns the loaded ports along with a feature map tracking which features are active.
 */
export async function loadTransitiveDependencies(
  rootPort: VcpkgPort,
  vcpkgFileDir: string,
  options: VcpkgOptions,
): Promise<{ rootPort: VcpkgPortInstance; ports: VcpkgPortMap; missingPorts: Set<string> }> {
  const vcpkgPath = existsSync(options.vcpkgPath)
    ? options.vcpkgPath
    : findExecutable(options.vcpkgPath) || options.vcpkgPath;

  const missingPorts = new Set<string>();

  // map holds all port that are already loaded and their corresponding active features and dependencies
  const ports: VcpkgPortMap = new Map();

  // the root port is already loaded, this is necessary to avoid trying to fetch the root port via the vcpkg CLI
  // defaultFeatures is set to false here, as we still need to fetch the default features for this port
  ports.set("[root]", {
    port: rootPort,
    features: new Set<string>(),
    dependencies: new Map(),
    defaultFeatures: false,
  });

  // list to collect pending requests for ports. a request can mean two things:
  // 1) the port is not loaded yet
  //    => load the port with the given features and dependencies and add it to the map of loaded ports
  // 2) the port is already loaded
  //    => update the active features for this port by adding the specified features to the already activated features
  //       and add all new transitive dependencies that arise from the newly enabled features
  const pendingPorts: VcpkgPendingPort[] = [
    // request to fetch the default features and the dependencies (including feature-based dependencies) of the root port
    // also set `postFetchDependencies` to simulate that the root port was just fetched
    {
      name: "[root]",
      features: new Set<string>(),
      defaultFeatures: true,
      postFetchDependencies: true,
    },
  ];

  // create a filter to remove any unnecessary pending requests, this works because 'ports' is passed by reference
  const changedPendingPortFilter = createChangedPendingPortFilter(ports);

  while (pendingPorts.length > 0) {
    // collect pending requests for the next round
    const nextPendingPorts: VcpkgPendingPort[] = [];

    // 1. fetch not loaded ports
    const portsToFetch = pendingPorts.filter(
      (pending) => !ports.has(pending.name) && !missingPorts.has(pending.name),
    );
    if (portsToFetch.length > 0) {
      const portNamesToFetch = portsToFetch.map((pending) => pending.name);
      const fetchedPorts = await retrievePortInfo(portNamesToFetch, vcpkgFileDir, vcpkgPath);
      for (const pending of portsToFetch) {
        const fetchedPort = fetchedPorts[pending.name];
        if (!fetchedPort) {
          missingPorts.add(pending.name);
          continue;
        }
        // add the newly fetched port to the map of loaded ports
        // no features are active for this port yet, these will be activated in the next step
        ports.set(pending.name, {
          port: fetchedPort,
          features: new Set(),
          dependencies: new Map(),
          defaultFeatures: false,
        });

        // request to fetch the non-feature dependencies as well
        pending.postFetchDependencies = true;
      }
    }

    // 2. handle newly fetched ports
    pendingPorts
      .filter((pending) => pending.postFetchDependencies && !missingPorts.has(pending.name))
      .forEach((pending) => {
        const portInfo = ports.get(pending.name)!;

        const nonFeatureDeps = collectNonFeatureDependencies(portInfo, options);

        // fetch non-feature dependencies, only need to be done once per port after it is loaded
        nextPendingPorts.push(...nonFeatureDeps.filter(changedPendingPortFilter));
        nonFeatureDeps.forEach((dep) => updatePortDependenciesFromPending(portInfo, dep));

        if (options.includeAllFeatures) {
          // if flag is set, we need to request all features for this port to be enabled
          // still we might need to filter the features by platform, as not all features might be active for the target platform
          const featuresToActivate = Object.entries(portInfo.port.features ?? {})
            .filter(
              ([, feat]) =>
                feat.supports === undefined ||
                matchesPlatform(feat.supports, options.targetPlatform),
            )
            .map(([featName]) => featName);
          featuresToActivate.forEach((feat) => pending.features.add(feat));
        }
      });

    // 3. extract feature-aware dependencies for all requests
    pendingPorts
      .filter((pending) => !missingPorts.has(pending.name))
      .forEach((pending) => {
        const portInfo = ports.get(pending.name)!;
        const featuresToActivate: string[] = [...pending.features].filter(
          (feature) => !portInfo.features.has(feature),
        );

        if (pending.defaultFeatures && !portInfo.defaultFeatures) {
          // default features should be enabled for this port, but are currently not, enable them
          portInfo.defaultFeatures = true;
          const defaultFeatures =
            portInfo.port["default-features"]
              ?.filter((feat) => {
                return options.includeAllFeatures || filterByPlatform(feat, options.targetPlatform);
              })
              .map((feat) => {
                return typeof feat === "string" ? feat : feat.name;
              }) ?? [];

          featuresToActivate.push(...defaultFeatures);
        }

        portInfo.features = portInfo.features.union(new Set(featuresToActivate));

        // collect new dependencies that arise from the newly enabled features and add them to the pending requests for the next round
        const newFeatureDeps = collectFeatureDependencies(
          portInfo,
          new Set(featuresToActivate),
          options.targetPlatform,
        );

        nextPendingPorts.push(...newFeatureDeps.filter(changedPendingPortFilter));
        newFeatureDeps.forEach((dep) => updatePortDependenciesFromPending(portInfo, dep));
      });

    pendingPorts.splice(0, pendingPorts.length, ...nextPendingPorts);
  }

  const rootPortRes = ports.get("[root]")!;
  ports.delete("[root]");
  return { rootPort: rootPortRes, ports, missingPorts };
}

export function portToVersion(port: VcpkgPort): string | undefined {
  return port.version ?? port["version-date"] ?? port["version-semver"] ?? port["version-string"];
}

function portInstanceToPurl(portInfo: VcpkgPortInstance): string {
  const depName = portInfo.port.name;
  const version = portToVersion(portInfo.port);
  if (!depName || !version) {
    throw new Error(
      `Could not retrieve name or version for dependency "${depName}". ` +
        `Full dependency info: ${JSON.stringify(portInfo)}.`,
    );
  }
  return createVcpkgPurl(depName, version, false);
}
