import {
  type AnalyzerResult,
  type ExternalReference,
  type Extractor,
  type Package,
  filesExtractor,
  readNormalizedTextFile,
  scanAndMarkFiles,
} from "@scatool/analyzer-core";
import { PackageURL } from "packageurl-js";

export { extractCycloneDXV2 } from "./converter-v2.ts";
export { extractorV2 as cyclonedxExtractorV2 } from "./extractor-v2.ts";

export const extractor: Extractor = filesExtractor({
  name: "cyclonedx",
  version: 1,
  markFiles: async function (codebase: string) {
    await scanAndMarkFiles(this, codebase, "**/*.cdx.json", []);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await readNormalizedTextFile(file);
    return extractCycloneDX(content, file);
  },
});

type CycloneDXComponent = {
  "bom-ref"?: string;
  type?: string;
  name?: string;
  purl?: string;
  version?: string;
  externalReferences?: Array<{
    type?: string;
    url?: string | object;
  }>;
  components?: CycloneDXComponent[];
  evidence?: {
    occurrences?: Array<{
      location?: string;
      line?: number;
    }>;
  };
};

type CycloneDXDependency = {
  ref?: string;
  dependsOn?: string[];
};

type CycloneDXBom = {
  bomFormat?: string;
  specVersion?: string;
  components?: CycloneDXComponent[];
  dependencies?: CycloneDXDependency[];
};

export function extractCycloneDX(content: string, filePath?: string): AnalyzerResult {
  try {
    const bom: CycloneDXBom = JSON.parse(content);

    // Verify it's a CycloneDX BOM
    if (bom.bomFormat !== "CycloneDX") {
      return {
        packages: [],
        subprojects: [],
        relationships: [],
        issues: filePath
          ? [
              {
                code: "cyclonedx.not_cyclonedx_bom",
                message: `Not a CycloneDX BOM (bomFormat: ${bom.bomFormat ?? "missing"})`,
                severity: "WARNING",
                file: filePath,
              },
            ]
          : [],
      };
    }

    const packages: Package[] = [];
    const relationships: Array<{ from: string; to: string[] }> = [];
    const bomRefToPurl = new Map<string, string>();

    // Extract all components recursively
    function processComponents(components: CycloneDXComponent[] | undefined, parentFile?: string) {
      if (!components) return;

      for (const component of components) {
        // Skip components without PURLs as per requirements
        if (!component.purl) {
          continue;
        }

        // Validate PURL format
        let validatedPurl: string;
        try {
          const parsed = PackageURL.fromString(component.purl);
          validatedPurl = parsed.toString();
        } catch {
          // Skip invalid PURLs
          continue;
        }

        // Build evidence array
        const evidence: string[] = [];

        // Add file evidence if available
        if (parentFile) {
          evidence.push(parentFile);
        }

        // Add occurrence evidence from CycloneDX evidence field
        if (component.evidence?.occurrences) {
          for (const occurrence of component.evidence.occurrences) {
            if (occurrence.location) {
              if (occurrence.line !== undefined) {
                evidence.push(`${occurrence.location}#${occurrence.line}`);
              } else {
                evidence.push(occurrence.location);
              }
            }
          }
        }

        const distributionReference = component.externalReferences?.find(
          (reference) => reference.type === "distribution" && typeof reference.url === "string",
        );
        const downloadLocation =
          typeof distributionReference?.url === "string" ? distributionReference.url : undefined;
        const externalReferences: ExternalReference[] = [];
        for (const reference of component.externalReferences ?? []) {
          if (typeof reference.url !== "string") continue;
          if (reference.type === "vcs") {
            externalReferences.push({ type: "vcs", locator: reference.url });
          } else if (reference.type === "source-distribution") {
            externalReferences.push({ type: "sourceArtifact", locator: reference.url });
          }
        }

        packages.push({
          purl: validatedPurl,
          evidence,
          ...(downloadLocation !== undefined && { downloadLocation }),
          ...(externalReferences.length > 0 && { externalReferences }),
        });

        // Map bom-ref to purl for dependency resolution
        if (component["bom-ref"]) {
          bomRefToPurl.set(component["bom-ref"], validatedPurl);
        }

        // Process nested components
        if (component.components) {
          processComponents(component.components, parentFile);
        }
      }
    }

    processComponents(bom.components, filePath);

    // Process dependencies
    if (bom.dependencies) {
      for (const dep of bom.dependencies) {
        if (!dep.ref || !dep.dependsOn || dep.dependsOn.length === 0) {
          continue;
        }

        const fromPurl = bomRefToPurl.get(dep.ref);
        if (!fromPurl) {
          continue;
        }

        const toPurls: string[] = [];
        for (const dependsOnRef of dep.dependsOn) {
          const toPurl = bomRefToPurl.get(dependsOnRef);
          if (toPurl) {
            toPurls.push(toPurl);
          }
        }

        if (toPurls.length > 0) {
          relationships.push({
            from: fromPurl,
            to: toPurls,
          });
        }
      }
    }

    return {
      packages,
      subprojects: [],
      relationships,
      issues: [],
    };
  } catch (error) {
    return {
      packages: [],
      subprojects: [],
      relationships: [],
      issues: filePath
        ? [
            {
              code: "cyclonedx.parse_failed",
              message: `Failed to parse CycloneDX BOM: ${error instanceof Error ? error.message : String(error)}`,
              severity: "ERROR",
              file: filePath,
            },
          ]
        : [],
    };
  }
}
