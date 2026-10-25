import { PackageURL } from "packageurl-js";
import { valid, validRange, satisfies } from "semver";
import type { DependencyRequest } from "@scatool/analyzer-core";
import { table, type NpmRecord } from "../npm-v2.ts";
import { DenoObservation, genericPurl, registryPurl, type RegistryKind } from "./observation.ts";

type NpmBinding = { alias: string; raw: string; target?: string; request: DependencyRequest };

/** Register native packages first, then resolve their lock-recorded bindings without manifest input. */
export function observeLockedPackages(
  native: DenoObservation,
  { document, tables, version }: { document: NpmRecord; tables: NpmRecord; version: number },
) {
  // Register all native packages before resolving references to them.
  const npmViewsByName = new Map<string, string[]>();
  const registerPackage = (
    kind: RegistryKind,
    key: string,
    metadata: NpmRecord,
    missing = false,
  ): string => {
    const id = `${kind}:${JSON.stringify(key)}`;
    if (native.nodes.has(id)) return id;

    const parsed = packageDescriptor(key);
    const baseVersion = parsed.reference?.split("_")[0];
    const identified = baseVersion !== undefined && valid(baseVersion) !== null;
    const purl = identified
      ? registryPurl(kind, parsed.name, baseVersion)
      : genericPurl("deno-package", [kind, key]);
    if (!identified)
      native.issue(
        "deno.invalid_package_id",
        `Native package ID '${key}' has no exact version; retaining it with a generic PURL`,
      );

    native.package(id, purl, key, metadata, kind === "npm" && !missing, !identified);
    if (missing) {
      native.nodes.get(id)!.attributes!["deno:packageMissing"] = true;
      native.issue(
        "deno.missing_package",
        `Native '${kind}:${key}' binding has no package record; adjacency remains unknown`,
      );
    } else if (kind === "npm") {
      npmViewsByName.set(parsed.name, [...(npmViewsByName.get(parsed.name) ?? []), id]);
    }

    return id;
  };

  for (const kind of ["npm", "jsr"] as const) {
    for (const [key, metadata] of Object.entries(table(tables, kind))) {
      registerPackage(kind, key, record(metadata));
    }
  }

  for (const [url, checksum] of Object.entries(table(document, "remote"))) {
    if (typeof checksum !== "string")
      throw new Error(`Expected a Deno remote checksum for '${url}'`);

    const id = `remote:${JSON.stringify(url)}`;
    native.package(
      id,
      genericPurl("deno-http", [url]),
      url,
      { url, integrity: checksum },
      false,
      true,
    );
  }

  // A registry request resolves through the lockfile specifier table, not a guessed version.
  const specifiers = table(tables, "specifiers");
  const specifierIndex = new Map<string, string[]>();
  for (const key of Object.keys(specifiers)) {
    const request = registryRequest(key);
    if (!request) continue;

    const name = `${request.kind}:${request.name}`;
    specifierIndex.set(name, [...(specifierIndex.get(name) ?? []), key]);
  }

  const resolveRegistryRequirement = (
    value: string,
  ): { request: DependencyRequest; target?: string } => {
    const parsed = registryRequest(value);
    const request: DependencyRequest = { ...(parsed && { name: parsed.name }), specifier: value };
    if (!parsed) return { request };

    const keys = Object.hasOwn(specifiers, value)
      ? [value]
      : parsed.reference === undefined
        ? (specifierIndex.get(`${parsed.kind}:${parsed.name}`) ?? [])
        : [];
    if (keys.length !== 1) return { request };

    const resolution = specifiers[keys[0]!];
    if (typeof resolution !== "string")
      throw new Error(`Invalid Deno specifier resolution: ${keys[0]}`);

    const full = resolution.startsWith(`${parsed.kind}:`)
      ? resolution.slice(parsed.kind.length + 1)
      : version === 3
        ? resolution
        : `${parsed.name}@${resolution}`;
    const descriptor = packageDescriptor(full);
    if (descriptor.reference === undefined || valid(descriptor.reference.split("_")[0]!) === null)
      return { request };

    return { request, target: registerPackage(parsed.kind, full, {}, true) };
  };

  const readNpmBinding = (value: string, alias?: string, allowMissing = true): NpmBinding => {
    const aliasAt = value.indexOf("@npm:");
    const actual = aliasAt > 0 ? value.slice(aliasAt + 5) : value.replace(/^npm:/, "");
    const parsed = packageDescriptor(actual);
    const name = alias ?? (aliasAt > 0 ? value.slice(0, aliasAt) : parsed.name);

    if (parsed.reference === undefined) {
      const candidates = npmViewsByName.get(parsed.name) ?? [];
      if (candidates.length > 1)
        native.issue(
          "deno.ambiguous_dependency",
          `Bare npm dependency '${parsed.name}' has multiple native peer/version contexts; none is selected arbitrarily`,
        );

      return {
        alias: name,
        raw: value,
        request: { name },
        ...(candidates.length === 1 && { target: candidates[0] }),
      };
    }

    const exact = valid(parsed.reference.split("_")[0]!) !== null;
    const existing = `npm:${JSON.stringify(actual)}`;
    const target =
      exact && native.nodes.has(existing)
        ? existing
        : exact && allowMissing
          ? registerPackage("npm", actual, {}, true)
          : undefined;

    return {
      alias: name,
      raw: value,
      request: {
        name,
        ...((!exact || (!allowMissing && validRange(parsed.reference) !== null)) && {
          specifier: parsed.reference,
        }),
      },
      ...(target !== undefined && { target }),
    };
  };

  const readNpmBindings = (metadata: NpmRecord, scope: string): NpmBinding[] => {
    const value = metadata[scope];
    if (value === undefined) return [];

    if (Array.isArray(value))
      return strings(value).map((value) =>
        readNpmBinding(value, undefined, scope !== "optionalPeers"),
      );

    return Object.entries(record(value)).map(([alias, value]) => {
      if (typeof value !== "string") throw new Error(`Invalid Deno npm dependency '${alias}'`);
      return readNpmBinding(value, alias, scope !== "optionalPeers");
    });
  };

  const matchesOptionalPeer = (binding: NpmBinding, peer: NpmBinding): boolean => {
    if (peer.alias !== binding.alias) return false;
    if (peer.target !== undefined && peer.target === binding.target) return true;
    if (peer.request.specifier === undefined || binding.target === undefined) return false;

    // Optional peer records may describe a range instead of repeating the selected package ID.
    const target = native.nodes.get(binding.target)!;
    const version = PackageURL.fromString(target.purl).version;
    return (
      version !== undefined &&
      version !== null &&
      validRange(peer.request.specifier) !== null &&
      satisfies(version, peer.request.specifier)
    );
  };

  // Iterate the source table, not placeholders registered while resolving missing references.
  for (const [key, value] of Object.entries(table(tables, "npm"))) {
    const metadata = record(value);
    const from = `npm:${JSON.stringify(key)}`;
    const dependencies = readNpmBindings(metadata, "dependencies");
    const optionalDependencies =
      version >= 5 ? readNpmBindings(metadata, "optionalDependencies") : [];
    const optionalPeers = version >= 5 ? readNpmBindings(metadata, "optionalPeers") : [];
    const usedPeers = new Set<NpmBinding>();

    for (const binding of dependencies) {
      const peer = optionalPeers.find((peer) => matchesOptionalPeer(binding, peer));
      if (peer) usedPeers.add(peer);

      if (
        optionalDependencies.some(
          (optional) => optional.alias === binding.alias && optional.target === binding.target,
        )
      )
        continue;

      native.edge(
        from,
        peer?.request.specifier ? peer.request : binding.request,
        binding.target,
        peer ? "peerDependencies" : "dependencies",
        {
          ...(peer && { optional: true }),
          attributes: {
            "deno:dependencyReference": binding.raw,
            ...(peer && { "deno:optionalPeer": peer.raw }),
          },
        },
      );
    }

    for (const binding of optionalDependencies) {
      native.edge(from, binding.request, binding.target, "optionalDependencies", {
        optional: true,
        attributes: { "deno:dependencyReference": binding.raw },
      });
    }

    for (const binding of optionalPeers) {
      if (!usedPeers.has(binding)) {
        native.edge(from, binding.request, binding.target, "peerDependencies", {
          optional: true,
          selection: "unknown",
          attributes: { "deno:dependencyReference": binding.raw },
          declaration: binding.target === undefined,
        });
      }
    }
  }

  for (const [key, value] of Object.entries(table(tables, "jsr"))) {
    for (const dependency of strings(record(value).dependencies)) {
      const resolved = resolveRegistryRequirement(dependency);
      native.edge(`jsr:${JSON.stringify(key)}`, resolved.request, resolved.target, "dependencies", {
        attributes: { "deno:requirement": dependency },
      });
    }
  }

  return { specifiers, resolveRegistryRequirement };
}

function packageDescriptor(value: string): { name: string; reference?: string } {
  const at = value.indexOf("@", 1);
  return at === -1 ? { name: value } : { name: value.slice(0, at), reference: value.slice(at + 1) };
}

function registryRequest(
  value: string,
): (ReturnType<typeof packageDescriptor> & { kind: RegistryKind }) | undefined {
  const kind = value.startsWith("npm:") ? "npm" : value.startsWith("jsr:") ? "jsr" : undefined;
  return kind ? { kind, ...packageDescriptor(value.slice(kind.length + 1)) } : undefined;
}

export function record(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Deno lock/config record");
  return value as NpmRecord;
}

export function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new Error("Expected Deno dependency specifier strings");
  return value;
}
