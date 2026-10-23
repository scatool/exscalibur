import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseResult } from "@scatool/analyzer-core";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pin = z.string().regex(/^[a-f0-9]{40}$/);
const nonempty = z.string().min(1);
const evidenceSchema = z.object({
  kind: z.enum(["package-json-declarations", "npm-shrinkwrap-v1"]),
  source: z.object({
    commit: pin,
    tree: pin,
    archiveSha256: hash,
    files: z.array(z.object({ path: nonempty, sha256: hash })).min(1),
  }),
  tools: z.array(z.object({ name: nonempty, version: nonempty })).min(1),
  assertions: z.array(nonempty).min(1),
  review: z.object({ path: nonempty, sha256: hash }),
});
const caseSchema = z.looseObject({
  id: nonempty,
  repository: nonempty,
  commit: pin,
  status: z.enum(["pending-source-review", "accepted"]),
  configuration: z.looseObject({
    extractorOptions: z.record(z.string(), z.unknown()),
    javaVersion: z.number().optional(),
    requiredTools: z.array(z.looseObject({ tool: nonempty, version: nonempty })),
  }),
  baseline: z.looseObject({ path: nonempty, sha256: hash, acceptedSha256: hash.optional() }),
  reviewEvidence: z.union([z.array(z.unknown()).length(0), evidenceSchema]),
});
const ledgerSchema = z.looseObject({
  schemaVersion: z.literal(1),
  configurationSha256: hash,
  cases: z.array(caseSchema),
});
export type AcceptanceCase = z.infer<typeof caseSchema>;
export interface RepositoryConfig {
  owner: string;
  repository: string;
  commit: string;
  options?: Record<string, Partial<unknown>>;
  javaVersion?: number;
}
export const sha256 = (text: string | Uint8Array): string =>
  createHash("sha256").update(text).digest("hex");
export const codebaseIdFor = (config: RepositoryConfig): string =>
  `integration:${config.owner}/${config.repository}@${config.commit}`;

/** Validate the entire ledger before running any individual integration case. */
export function validateAcceptanceLedger(
  configurationText: string,
  input: unknown,
): AcceptanceCase[] {
  const configs = JSON.parse(configurationText) as RepositoryConfig[];
  const ledger = ledgerSchema.parse(input);
  if (sha256(configurationText) !== ledger.configurationSha256)
    throw new Error("Integration configuration hash changed; review the acceptance ledger");
  const ids = new Set<string>();
  for (const entry of ledger.cases) {
    if (ids.has(entry.id)) throw new Error(`Duplicate integration acceptance case: ${entry.id}`);
    ids.add(entry.id);
    const config = configs.find((c) => `${c.owner}+${c.repository}` === entry.id);
    if (
      !config ||
      entry.repository !== `${config.owner}/${config.repository}` ||
      entry.commit !== config.commit
    )
      throw new Error(`Integration acceptance pin mismatch: ${entry.id}`);
    if (
      !isDeepStrictEqual(entry.configuration.extractorOptions, config.options ?? {}) ||
      entry.configuration.javaVersion !== config.javaVersion
    )
      throw new Error(`Integration acceptance configuration mismatch: ${entry.id}`);
    const java = entry.configuration.requiredTools.filter((t) => t.tool === "java");
    if (
      !isDeepStrictEqual(
        java.map((t) => t.version),
        config.javaVersion === undefined ? [] : [String(config.javaVersion)],
      )
    )
      throw new Error(`Integration acceptance Java requirement mismatch: ${entry.id}`);
    if (entry.baseline.path !== `test/__snapshots__/${entry.id}.json`)
      throw new Error(`Integration acceptance baseline path mismatch: ${entry.id}`);
    if (entry.status === "accepted") {
      if (!entry.baseline.acceptedSha256 || Array.isArray(entry.reviewEvidence))
        throw new Error(`Accepted case lacks review evidence: ${entry.id}`);
      if (entry.reviewEvidence.source.commit !== config.commit)
        throw new Error(`Reviewed source pin mismatch: ${entry.id}`);
    }
  }
  if (ids.size !== configs.length || configs.some((c) => !ids.has(`${c.owner}+${c.repository}`)))
    throw new Error("Integration acceptance ledger must cover every configured case exactly once");
  return ledger.cases;
}

export function requireAcceptedCase(entry: AcceptanceCase): void {
  if (entry.status !== "accepted")
    throw new Error(
      `Tracked pending-source-review: ${entry.id}@${entry.commit}. See test/integration-migration.json; pinned source and semantic review are required before accepting a format 2 baseline.`,
    );
}

export function validateAcceptedBaseline(
  entry: AcceptanceCase,
  baselineText: string,
  reviewText: string,
) {
  requireAcceptedCase(entry);
  if (Array.isArray(entry.reviewEvidence)) throw new Error(`Missing review evidence: ${entry.id}`);
  if (sha256(baselineText) !== entry.baseline.acceptedSha256)
    throw new Error(`Reviewed baseline hash mismatch: ${entry.id}`);
  if (sha256(reviewText) !== entry.reviewEvidence.review.sha256)
    throw new Error(`Semantic review hash mismatch: ${entry.id}`);
  const result = parseResult(JSON.parse(baselineText));
  if (result.codebase !== `integration:${entry.repository}@${entry.commit}`)
    throw new Error(`Reviewed baseline codebase mismatch: ${entry.id}`);
  return result;
}
