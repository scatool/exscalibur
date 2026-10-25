import { dependencyScopes, table } from "../npm-manifest.ts";
import type { NpmRecord } from "../npm-graph.ts";
import { extractPackageName } from "./lockfile.ts";

/**
 * Lockfiles can omit files carried inside dependency archives. An outer placement is not
 * sufficient evidence for a binding that unreported bundled content could shadow.
 */
export function createBundleBoundaryResolver(
  packagesByLocation: Record<string, NpmRecord>,
  lockfileVersion: 1 | 2 | 3,
  hasRecordedBinding: (caller: string, name: string, boundary: string) => boolean,
) {
  const isInstalledPackage = (location: string) =>
    location.split("/").includes("node_modules") && packagesByLocation[location]?.link !== true;
  const bundlesByLocation = new Map(
    Object.entries(packagesByLocation)
      .filter(([location]) => isInstalledPackage(location))
      .map(([location, record]) => [location, bundledNames(record)]),
  );
  const owners = new Map<string, string | undefined>();

  const bundleOwner = (location: string): string | undefined => {
    if (owners.has(location)) return owners.get(location);

    const parent = parentPackageLocation(location);
    let owner: string | undefined;
    if (parent !== undefined && isInstalledPackage(parent)) {
      // An explicit nested bundle starts a nearer boundary. Otherwise a bundled descendant
      // shares its ancestor's boundary, including transitives hoisted beside that descendant.
      const explicitlyBundled = bundlesByLocation.get(parent)?.has(extractPackageName(location)!);
      owner = explicitlyBundled ? parent : bundleOwner(parent);
      const record = packagesByLocation[location];
      const recordedBundle =
        lockfileVersion === 1 ? record?.bundled === true : record?.inBundle === true;
      if (owner === undefined && recordedBundle) {
        owner = parent;
      }
    }

    owners.set(location, owner);
    return owner;
  };

  // A known bundled child's production dependencies may be hoisted inside its archive.
  // Their absent records can therefore also shadow the owner's same-name ordinary request.
  // Do not extend this uncertainty to unrelated nonbundled dependencies of the owner.
  const possibleBundleNames = new Map<string, Set<string>>();
  for (const [location, record] of Object.entries(packagesByLocation)) {
    const owner = bundleOwner(location);
    if (owner === undefined) continue;

    const names = possibleBundleNames.get(owner) ?? new Set<string>();
    for (const declaration of dependencyScopes(record)) {
      if (
        isProductionScope(declaration.scope) &&
        !bundlesByLocation.get(location)?.has(declaration.name) &&
        !hasRecordedBinding(location, declaration.name, owner)
      ) {
        names.add(declaration.name);
      }
    }
    possibleBundleNames.set(owner, names);
  }

  return (caller: string, name: string, scope: string): string | undefined => {
    // Root/workspace declarations describe future packing, not an installed archive.
    // Peers and development dependencies are not included by npm's bundle traversal.
    if (!isInstalledPackage(caller) || !isProductionScope(scope)) return undefined;

    if (bundlesByLocation.get(caller)?.has(name)) return caller;
    const owner = bundleOwner(caller);
    if (owner !== undefined) return owner;

    let ancestor: string | undefined = caller;
    while (ancestor !== undefined && isInstalledPackage(ancestor)) {
      if (possibleBundleNames.get(ancestor)?.has(name)) return ancestor;
      ancestor = parentPackageLocation(ancestor);
    }

    return undefined;
  };
}

function bundledNames(record: NpmRecord): Set<string> {
  // Match @npmcli/package-json normalization: the canonical field takes precedence,
  // and true expands dependencies before npm removes optional duplicates from that table.
  const value =
    record.bundleDependencies === undefined
      ? record.bundledDependencies
      : record.bundleDependencies;
  if (value === true) return new Set(Object.keys(table(record, "dependencies")));
  const names = Array.isArray(value)
    ? value.filter((name): name is string => typeof name === "string")
    : value !== null && typeof value === "object"
      ? Object.keys(value)
      : [];
  if (names.length === 0) return new Set();

  // npm-packlist follows production/optional edges, never a peer-only or dev-only name.
  const production = new Set([
    ...Object.keys(table(record, "dependencies")),
    ...Object.keys(table(record, "optionalDependencies")),
  ]);
  return new Set(names.filter((name) => production.has(name)));
}

function isProductionScope(scope: string): boolean {
  return scope === "dependencies" || scope === "optionalDependencies";
}

function parentPackageLocation(location: string): string | undefined {
  const separator = location.lastIndexOf("/node_modules/");
  if (separator >= 0) return location.slice(0, separator);
  return location.startsWith("node_modules/") ? "" : undefined;
}
