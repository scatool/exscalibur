import { normalize } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";
import { type NpmRecord } from "./npm-graph.ts";
import { table } from "./npm-manifest.ts";

// Load the CommonJS parser consistently in Node and transformed test modules.
const { parse: parseClassicLock } = createRequire(import.meta.url)(
  "@yarnpkg/lockfile",
) as typeof import("@yarnpkg/lockfile");

export type YarnLockEntry = {
  key: string;
  patterns: string[];
  locator: string;
  name: string;
  metadata: NpmRecord;
  workspace?: string;
};

/** Preserve native locator groups before any workspace or scope correlation. */
export function parseYarnLock(
  content: string,
  modern: boolean,
): { entries: YarnLockEntry[]; metadata: NpmRecord } {
  if (modern) {
    // Yarn's SYML reader uses the failsafe schema: unquoted ranges such as `6` or `true`
    // are strings, not YAML numbers/booleans. Metadata booleans are interpreted separately.
    const document = yarnRecord(parseYaml(content, { schema: "failsafe" }));
    const metadata = table(document, "__metadata");
    const version = Number(metadata.version);
    if (!Number.isInteger(version) || version < 4 || version > 9)
      throw new Error(
        `Unsupported Yarn modern lockfile version: ${JSON.stringify(metadata.version)}`,
      );

    const locators = new Map<string, YarnLockEntry>();
    for (const [key, value] of Object.entries(document)) {
      if (key === "__metadata") continue;
      const metadata = yarnRecord(value);
      if (typeof metadata.resolution !== "string")
        throw new Error(`Yarn entry '${key}' is missing its resolution locator`);

      const parsed = parseYarnDescriptor(metadata.resolution);
      const workspace = parsed.reference.startsWith("workspace:")
        ? normalize(parsed.reference.slice(10))
        : undefined;
      if (workspace === ".." || workspace?.startsWith("../") || workspace?.startsWith("/"))
        throw new Error(`Yarn workspace is outside its lockfile directory: ${workspace}`);

      const patterns = key.split(/ *, */g);
      const previous = locators.get(metadata.resolution);
      if (previous) {
        if (!isDeepStrictEqual(previous.metadata, metadata))
          throw new Error(`Conflicting Yarn resolution metadata: ${metadata.resolution}`);
        previous.patterns.push(...patterns);
      } else
        locators.set(metadata.resolution, {
          key,
          locator: metadata.resolution,
          name: parsed.name,
          patterns,
          metadata,
          ...(workspace !== undefined && { workspace }),
        });
    }

    return { entries: [...locators.values()], metadata };
  }

  // Classic parser groups descriptors by shared record identity. Preserve those native groups.
  const parsed = parseClassicLock(content);
  if (parsed.type !== "success")
    throw new Error("Yarn Classic lockfile contains unresolved merge conflicts");

  const groups = new Map<object, { patterns: string[]; metadata: NpmRecord }>();
  for (const [pattern, value] of Object.entries(parsed.object)) {
    const metadata = yarnRecord(value);
    const group = groups.get(value) ?? { patterns: [], metadata };
    group.patterns.push(pattern);
    groups.set(value, group);
  }

  const entries = [...groups.values()].map(({ patterns, metadata }) => {
    const parsed = parseYarnDescriptor(patterns[0]!);
    let name = parsed.name;
    if (parsed.reference.startsWith("npm:"))
      name = parseYarnDescriptor(parsed.reference.slice(4)).name;
    const key = [...patterns].sort().join(", ");
    return { key, patterns, metadata, name, locator: key };
  });

  return { entries, metadata: { version: 1, peerDeclarations: "not-recorded" } };
}

export function parseYarnDescriptor(value: string): { name: string; reference: string } {
  const at = value.indexOf("@", value.startsWith("@") ? value.indexOf("/") + 1 : 0);
  if (at < 1) throw new Error(`Invalid Yarn package descriptor: ${value}`);
  return { name: value.slice(0, at), reference: value.slice(at + 1) };
}

export function yarnRecord(value: unknown): NpmRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Yarn lockfile record");
  return value as NpmRecord;
}
