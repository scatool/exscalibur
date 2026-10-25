import { normalize } from "node:path/posix";
import { valid } from "semver";
import { NpmGraphV2, json, type NpmProject, type NpmRecord } from "../npm-v2.ts";
import type { BunWorkspace } from "./workspaces.ts";

export type BunPackageEntry = {
  key: string;
  identifier: string;
  name: string;
  reference: string;
  metadata: NpmRecord;
  tuple: unknown[];
  infoComplete: boolean;
};

/** Index complete native placements before any declaration is bound. */
export function registerBunPackagePlacements(
  packages: NpmRecord,
  lockfileVersion: unknown,
  projects: Map<string, BunWorkspace>,
  builder: NpmGraphV2,
) {
  const entries: BunPackageEntry[] = [];
  const workspaceAliases = new Map<BunPackageEntry, { project: NpmProject; view: string }>();
  const targets = new Map<string, string>();

  // Decode and register in native record order so malformed tuples retain their error order.
  for (const [key, value] of Object.entries(packages)) {
    if (!Array.isArray(value) || typeof value[0] !== "string")
      throw new Error(`Invalid Bun package tuple at '${key}'`);

    const parsed = identifier(value[0]);
    const workspace = parsed.reference.startsWith("workspace:");
    const infoRequired = parsed.reference !== "root:" && (!workspace || lockfileVersion === 0);
    const info = value[valid(parsed.reference) !== null ? 2 : 1];
    const infoObject = info !== null && typeof info === "object" && !Array.isArray(info);
    const metadata = infoObject ? readBunRecord(info) : {};
    const infoComplete = !infoRequired || infoObject;

    if (!infoComplete)
      builder.result.issues.push({
        code: "bun.invalid_package_info",
        severity: "WARNING",
        file: builder.context.relativeFile,
        message: `Package '${key}' has missing or invalid native INFO; dependency coverage remains unknown`,
      });

    const entry = { key, identifier: value[0], ...parsed, metadata, tuple: value, infoComplete };
    entries.push(entry);

    if (parsed.reference.startsWith("workspace:") || parsed.reference === "root:") {
      const project = projects.get(
        parsed.reference === "root:" ? "." : normalize(parsed.reference.slice(10)),
      );
      if (!project) throw new Error(`Bun workspace package '${key}' has no workspace record`);

      const id = `workspace-alias:${JSON.stringify(key)}`;
      builder.nodes.set(id, {
        ...structuredClone(builder.nodes.get(project.project.consumer)!),
        id,
        locator: key,
        ...(!infoComplete && { dependencyCompleteness: "unknown" as const }),
        attributes: {
          ...builder.nodes.get(project.project.consumer)!.attributes,
          "bun:tuple": json(value),
        },
      });

      workspaceAliases.set(entry, { project: project.project, view: id });
      targets.set(key, id);
    } else {
      const npm = valid(parsed.reference) !== null;
      const git = /^(?:git\+|git:|github:|gitlab:)/.test(parsed.reference);
      const tarball =
        /^https?:/.test(parsed.reference) ||
        /^file:.*\.(?:tgz|tar(?:\.gz)?)(?:[?#]|$)/.test(parsed.reference);
      const integrity = value[npm || git ? 3 : tarball ? 2 : -1];
      const location =
        npm && typeof value[1] === "string" && value[1]
          ? value[1]
          : tarball
            ? parsed.reference
            : undefined;
      const version = npm
        ? parsed.reference
        : typeof metadata.version === "string"
          ? metadata.version
          : "";

      const id = builder.addPackage(
        `package:${JSON.stringify(key)}`,
        parsed.name,
        {
          ...metadata,
          version,
          ...(typeof integrity === "string" && integrity && { integrity }),
          ...(location !== undefined && { resolved: location }),
        },
        infoComplete,
      );
      builder.nodes.get(id)!.locator = key;
      builder.nodes.get(id)!.attributes!["bun:tuple"] = json(value);
      targets.set(key, id);
    }
  }

  // Determine the private subtree used by each workspace before resolving any dependency.
  for (const [location, item] of projects) {
    if (location === ".") continue;

    const name = item.project.manifest.name;
    const aliases = [...workspaceAliases]
      .filter(([, alias]) => alias.project === item.project)
      .map(([entry]) => entry);

    // An unlinked workspace can share its name with a registry dependency. Bun then prints
    // the workspace's private subtree under './name', rather than under the registry slot.
    item.caller =
      typeof name === "string" && aliases.some((entry) => entry.key === name)
        ? name
        : (aliases.find((entry) => entry.key.startsWith("./"))?.key ??
          (typeof name === "string" ? `./${name}` : ""));
  }

  const resolvePlacement = (caller: string, name: string): string | undefined => {
    const segments = pathSegments(caller);
    while (true) {
      const candidate = [...segments, name].join("/");
      if (targets.has(candidate)) return targets.get(candidate);
      if (segments.length === 0) return undefined;
      segments.pop();
    }
  };

  const resolveDependency = (
    caller: string,
    name: string,
    specifier: string,
  ): string | undefined => {
    const placement = resolvePlacement(caller, name);
    if (!specifier.startsWith("workspace:") || (placement && builder.nodes.get(placement)?.project))
      return placement;

    const path = normalize(specifier.slice(10));
    const members = [...projects].filter(
      ([location, item]) =>
        item.project.manifest.name === name || (path !== "." && path === location),
    );
    if (members.length > 1)
      throw new Error(`Ambiguous Bun workspace reference: ${name}@${specifier}`);

    const member = members[0]?.[1].project;
    if (!member) return undefined;

    return (
      [...workspaceAliases].find(
        ([entry, alias]) => alias.project === member && entry.key.startsWith("./"),
      )?.[1].view ?? member.consumer
    );
  };

  return { entries, workspaceAliases, targets, resolveDependency };
}

export function readBunRecord(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Bun lockfile record");
  return value as NpmRecord;
}

function identifier(value: string): { name: string; reference: string } {
  if (value === "@root:") return { name: "", reference: "root:" };
  const at = value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0);
  if (at < 1) throw new Error(`Invalid Bun package identifier: ${value}`);
  return { name: value.slice(0, at), reference: value.slice(at + 1) };
}

export function readBunDependencyNames(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new Error("Expected Bun dependency name strings");
  return value;
}

function pathSegments(path: string): string[] {
  const pieces = path ? path.split("/") : [];
  const segments: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const value = pieces[i]!;
    if (value.startsWith("@")) {
      if (!pieces[i + 1]) throw new Error(`Invalid Bun scoped package path: ${path}`);
      segments.push(`${value}/${pieces[++i]}`);
    } else segments.push(value);
  }
  return segments;
}
