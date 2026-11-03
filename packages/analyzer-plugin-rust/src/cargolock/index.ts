import { parse as parseToml } from "smol-toml";
import {
  filesExtractor,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type DependencyRequest,
} from "@scatool/analyzer-core";
import { optionSchema } from "../options.ts";
import {
  CargoObservation,
  array,
  cargoIdentity,
  json,
  record,
  strings,
  text,
  type CargoRecord,
} from "../observation.ts";

type LockEntry = {
  id: string;
  name: string;
  version: string;
  source?: string;
  record: CargoRecord;
};

export const extractor = filesExtractor({
  name: "cargolock",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase, options) {
    await scanAndMarkFiles(this, codebase, "**/Cargo.lock", options.ignore);
  },
  extractFile: async (file, _options, context) => {
    const document = record(parseToml(await readNormalizedTextFile(file)));
    if (document.version !== undefined && ![1, 2, 3, 4].includes(document.version as number))
      throw new Error(`Unsupported Cargo lockfile version: ${JSON.stringify(document.version)}`);
    const builder = new CargoObservation(
      { codebase: context.codebaseId, evidenceFile: context.relativeFile },
      "raw-lock-records",
      "locked",
      "cargolock",
    );
    builder.attributes["cargo:document"] = json(document);
    builder.attributes["cargo:projection"] = "raw-lock-records";
    builder.attributes["cargo:effectiveFeatureResolution"] = "not-observed";
    builder.attributes["cargo:workspaceMembership"] = "not-observed";
    builder.attributes["cargo:reportedLockVersion"] =
      document.version === undefined ? null : json(document.version);
    builder.issue(
      "cargo.raw_lock_projection",
      "Cargo.lock has no project scopes, dependency kinds, target predicates or activated features; path packages do not establish workspace membership",
      "HINT",
    );
    const entries = new Map<string, LockEntry>();
    const metadata = document.metadata === undefined ? {} : record(document.metadata);
    const register = (value: unknown, unused = false): LockEntry => {
      const item = record(value),
        name = text(item.name),
        version = text(item.version);
      const source = item.source === undefined ? undefined : text(item.source);
      const identity = JSON.stringify([name, version, source ?? null]);
      const id = `${unused ? "unused-patch:" : "package:"}${identity}`;
      if (!unused && entries.has(identity))
        throw new Error(`Duplicate native Cargo lock identity: ${identity}`);
      const coordinates = cargoIdentity(name, version, source, [
        context.codebaseId,
        context.relativeFile,
        identity,
      ]);
      const checksumKey = `checksum ${name} ${version}${source === undefined ? "" : ` (${source})`}`;
      const legacyChecksum = metadata[checksumKey];
      const checksums = [
        ...new Set(
          [item.checksum, legacyChecksum].filter(
            (value) => value !== undefined && value !== "<none>",
          ),
        ),
      ];
      if (item.checksum !== undefined && legacyChecksum !== undefined)
        builder.issue(
          "cargo.mixed_checksum_formats",
          `Package '${name} ${version}' has inline and legacy checksum representations; retaining both without selecting one`,
        );
      const artifacts = checksums.flatMap((checksum) => {
        if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/i.test(checksum)) {
          builder.issue(
            "cargo.invalid_checksum",
            `Package '${name} ${version}' has an invalid native SHA-256 checksum; the raw value is preserved`,
          );
          return [];
        }
        return [{ hashes: { sha256: checksum.toLowerCase() }, evidence: [context.relativeFile] }];
      });
      builder.package(
        {
          id,
          purl: coordinates.purl,
          locator: identity,
          evidence: [context.relativeFile],
          dependencyCompleteness: unused ? "unknown" : "complete",
          ...(artifacts.length > 0 && { artifacts }),
          attributes: {
            "cargo:lockPackage": json(item),
            ...(unused && { "cargo:unusedPatch": true }),
            ...(legacyChecksum !== undefined && { "cargo:legacyChecksum": json(legacyChecksum) }),
          },
        },
        coordinates.synthesizedPurl,
      );
      const entry = { id, name, version, ...(source !== undefined && { source }), record: item };
      if (!unused) entries.set(identity, entry);
      return entry;
    };
    if (document.root !== undefined) {
      const root = register(document.root);
      const project = builder.project(root.id, `${context.relativeFile}#root`, "lock.root");
      builder.root(project, "cargo:locked-dependencies", root.id);
      builder.rootCompleteness = "complete";
    }
    for (const value of document.package === undefined ? [] : array(document.package))
      register(value);
    if (document.patch !== undefined) {
      const patches = record(document.patch);
      for (const value of patches.unused === undefined ? [] : array(patches.unused))
        register(value, true);
    }
    const binding = (reference: string): { target?: string; requested: DependencyRequest } => {
      const parsed = /^([^\s]+)(?: ([^\s]+)(?: \((.+)\))?)?$/.exec(reference);
      const requested: DependencyRequest = {
        ...(parsed && { name: parsed[1]! }),
        attributes: { "cargo:lockReference": reference },
      };
      if (!parsed) {
        builder.issue(
          "cargo.invalid_lock_reference",
          `Malformed Cargo lock reference '${reference}' remains unresolved`,
        );
        return { requested };
      }
      const [, name, version, source] = parsed;
      const matches = [...entries.values()].filter(
        (entry) =>
          entry.name === name &&
          (version === undefined || entry.version === version) &&
          (source === undefined || entry.source === source),
      );
      if (version === undefined && new Set(matches.map((entry) => entry.version)).size > 1) {
        builder.issue(
          "cargo.unresolved_lock_reference",
          `Cargo lock reference '${reference}' omits an ambiguous version; path preference cannot choose its version`,
        );
        return { requested };
      }
      // Cargo's decoder interprets source-less references as path IDs first. A unique
      // remaining non-path source can be abbreviated only if no path candidate exists.
      const local =
        source === undefined ? matches.filter((entry) => entry.source === undefined) : [];
      const candidates = local.length > 0 ? local : matches;
      if (candidates.length === 1) return { requested, target: candidates[0]!.id };
      builder.issue(
        "cargo.unresolved_lock_reference",
        `Cargo lock reference '${reference}' has ${candidates.length} native candidates; no arbitrary package is selected`,
      );
      return { requested };
    };
    for (const entry of entries.values()) {
      for (const reference of entry.record.dependencies === undefined
        ? []
        : strings(entry.record.dependencies)) {
        const resolved = binding(reference);
        const common = {
          from: entry.id,
          relation: "depends-on" as const,
          kind: "cargo:locked-dependencies",
          selection: "selected" as const,
          requested: resolved.requested,
          evidence: [context.relativeFile],
        };
        builder.edges.push(
          resolved.target === undefined
            ? { ...common, status: "unresolved" }
            : { ...common, status: "resolved", to: resolved.target },
        );
      }
      if (entry.record.replace !== undefined) {
        const reference = text(entry.record.replace),
          resolved = binding(reference);
        const common = {
          from: entry.id,
          relation: "constrains" as const,
          kind: "cargo:replace",
          selection: "selected" as const,
          requested: resolved.requested,
          evidence: [context.relativeFile],
        };
        builder.edges.push(
          resolved.target === undefined
            ? { ...common, status: "unresolved" }
            : { ...common, status: "resolved", to: resolved.target },
        );
      }
    }
    // Without legacy [root], inventory membership does not identify entry projects.
    return builder.finish();
  },
});
