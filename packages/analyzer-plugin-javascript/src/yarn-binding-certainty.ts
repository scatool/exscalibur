import { validRange } from "semver";
import { parseYarnDescriptor, type YarnLockEntry } from "./yarn-lock.ts";

export type YarnRootPolicy = { resolutions?: unknown; file: string };
export type YarnIssuer = { name?: string; reference?: string };
type Selector = { name: string; reference?: string };
type ResolutionRule = { key: string; dependency: Selector; issuer?: Selector };

type BindingUncertainty = {
  reason: "root-policy-unavailable" | "unapplied-resolution" | "patch-alternative";
  selectors?: string[];
};

/** A raw descriptor match is not an effective binding when native rewrites remain unobserved. */
export class YarnBindingCertainty {
  private readonly rules: ResolutionRule[] = [];
  private readonly patches = new Map<string, string[]>();
  private policyUnavailable: boolean;

  constructor(rootPolicy: YarnRootPolicy | undefined, modern: boolean, entries: YarnLockEntry[]) {
    this.policyUnavailable = rootPolicy === undefined;
    const resolutions = rootPolicy?.resolutions;

    if (resolutions !== undefined) {
      if (resolutions === null || typeof resolutions !== "object" || Array.isArray(resolutions)) {
        this.policyUnavailable = true;
      } else {
        for (const [key, value] of Object.entries(resolutions)) {
          const rule = modern ? modernRule(key) : classicRule(key);
          if (typeof value !== "string" || !rule) this.policyUnavailable = true;
          else this.rules.push(rule);
        }
      }
    }

    // Built-in compatibility hooks can rewrite a request while its unpatched
    // descriptor remains in the lock. An unrelated explicit/manual patch does
    // not establish such a rewrite and must not taint the ordinary binding.
    if (modern) {
      for (const entry of entries) {
        for (const pattern of entry.patterns) {
          const parsed = parseYarnDescriptor(pattern);
          if (!parsed.reference.startsWith("patch:")) continue;

          const source = parsed.reference.slice(6).split("#", 1)[0]!;
          try {
            const descriptor = parseYarnDescriptor(decodeURIComponent(source));
            if (
              parsed.name !== descriptor.name ||
              ![
                `#optional!builtin<compat/${descriptor.name}>`,
                `#~builtin<compat/${descriptor.name}>`,
              ].some((marker) => parsed.reference.includes(marker))
            )
              continue;
            const key = normalizedDescriptor(descriptor.name, descriptor.reference);
            this.patches.set(key, [...(this.patches.get(key) ?? []), pattern]);
          } catch {
            // An opaque patch source cannot establish a rewrite of an unrelated descriptor.
          }
        }
      }
    }
  }

  uncertainty(
    issuer: YarnIssuer,
    dependencyName: string,
    reference: string,
  ): BindingUncertainty | undefined {
    if (this.policyUnavailable) return { reason: "root-policy-unavailable" };

    const rule = this.rules.find((rule) => {
      if (rule.dependency.name !== dependencyName) return false;
      if (
        rule.dependency.reference !== undefined &&
        normalizeReference(rule.dependency.reference) !== normalizeReference(reference)
      )
        return false;
      if (!rule.issuer) return true;
      if (issuer.name !== undefined && rule.issuer.name !== issuer.name) return false;
      return (
        rule.issuer.reference === undefined ||
        issuer.reference === undefined ||
        normalizeReference(rule.issuer.reference) === normalizeReference(issuer.reference)
      );
    });
    if (rule) return { reason: "unapplied-resolution", selectors: [rule.key] };

    const patches = this.patches.get(normalizedDescriptor(dependencyName, reference));
    if (patches) return { reason: "patch-alternative", selectors: patches };

    return undefined;
  }
}

function modernRule(key: string): ResolutionRule | undefined {
  // Berry's resolution grammar allows one optional issuer and scoped identities.
  // Yarn 4 compares normalized references, not semver satisfaction. Older Berry
  // compares raw references: normalized equality is conservative for its policy
  // too, but is not used here to claim an override was actually applied.
  const identity = "(?:@[^/@]+/)?[^/@]+";
  const match = new RegExp(`^(?:(${identity})(?:@([^/]+))?/)?(${identity})(?:@([^/]+))?$`).exec(
    key,
  );
  if (!match || match[1]?.includes("*") || match[3]!.includes("*")) return undefined;

  return {
    key,
    dependency: { name: match[3]!, ...(match[4] !== undefined && { reference: match[4] }) },
    ...(match[1] !== undefined && {
      issuer: { name: match[1], ...(match[2] !== undefined && { reference: match[2] }) },
    }),
  };
}

function classicRule(key: string): ResolutionRule | undefined {
  // Classic selectors match ancestor paths. Lock records share those paths, so
  // only the final dependency identity can rule a transformation out here.
  const match = /(?:^|\/)((?:@[^/]+\/)?[^/]+)$/.exec(key);
  if (!match || /[*?[\]{}]/.test(match[1]!)) return undefined;
  return { key, dependency: { name: match[1]! } };
}

function normalizeReference(reference: string): string {
  return validRange(reference) !== null || /^(?!v)[a-z0-9._-]+$/i.test(reference)
    ? `npm:${reference}`
    : reference;
}

function normalizedDescriptor(name: string, reference: string): string {
  return `${name}@${normalizeReference(reference)}`;
}
