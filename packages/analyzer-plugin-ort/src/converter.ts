import {
  type AnalyzerResult,
  type DependencyScope,
  type Package,
  type Relationship,
  type Subproject,
} from "@scatool/analyzer-core";
import { dirname } from "node:path/posix";
// it's crucial that we do not use posix variant here for windows to work (e.g. for C:/path)
import { isAbsolute, resolve } from "node:path";
import { type OrtAnalyzerResult } from "./model.ts";
import { convertOrtIdToPurl } from "./id.ts";

const ORT_EXTERNAL_ISSUE_CODE = "ort.external_issue";

export interface ConvertOrtResultOptions {
  /**
   * The file path to use as evidence for packages.
   * If useDefinitionFilePaths is false, this will be used for all packages.
   * If useDefinitionFilePaths is true, this is used as the base path to resolve relative definition file paths.
   */
  evidenceFile: string;

  /**
   * If true, use the definition_file_path from ORT projects as evidence (e.g., package.json, build.gradle).
   * If false (default), use the evidenceFile (typically analyzer-result.json) as evidence.
   */
  useDefinitionFilePaths: boolean;
}

export function convertOrtResult(
  result: OrtAnalyzerResult,
  options: ConvertOrtResultOptions,
): AnalyzerResult {
  const { evidenceFile, useDefinitionFilePaths } = options;

  const packageMap = new Map<string, { purl: string; evidence: Set<string> }>();
  const packageIdToPurl = new Map<string, string>();
  const relationshipsMap = new Map<string, Set<string>>();
  const subprojects: Subproject[] = [];
  const issues: AnalyzerResult["issues"] = [];

  // Collect project IDs to filter them out from dependency graphs
  const projectIds = new Set<string>();
  if (result.projects) {
    for (const project of result.projects) {
      projectIds.add(project.id);
    }
  }

  if (result.packages) {
    for (const ortPackage of result.packages) {
      const purl = ortPackage.purl || convertOrtIdToPurl(ortPackage.id);
      packageIdToPurl.set(ortPackage.id, purl);
      if (!packageMap.has(purl)) {
        packageMap.set(purl, {
          purl,
          evidence: new Set([evidenceFile]),
        });
      }
    }
  }

  // Process projects and scopes
  if (result.projects && result.dependency_graphs) {
    for (const project of result.projects) {
      const projectPurl = convertOrtIdToPurl(project.id);

      let definitionFile: string;
      if (useDefinitionFilePaths) {
        definitionFile = isAbsolute(project.definition_file_path)
          ? project.definition_file_path
          : resolve(dirname(evidenceFile), project.definition_file_path);
      } else {
        definitionFile = evidenceFile;
      }

      const scopesMap = new Map<string, Set<string>>();
      for (const [, depGraph] of Object.entries(result.dependency_graphs)) {
        if (!depGraph.scopes) {
          // Skip empty dependency graphs
          continue;
        }

        // Process scopes in this dependency graph
        for (const [scopeKey, scopeRoots] of Object.entries(depGraph.scopes)) {
          const scopeName = scopeKey.split(":").pop() || scopeKey;
          if (!project.scope_names?.includes(scopeName)) {
            continue;
          }

          if (!scopesMap.has(scopeName)) scopesMap.set(scopeName, new Set());
          const scopePackages = scopesMap.get(scopeName)!;

          for (const scopeRoot of scopeRoots) {
            const packageId = depGraph.packages[scopeRoot.root];
            if (!packageId) continue;

            const packagePurl = packageIdToPurl.get(packageId) || convertOrtIdToPurl(packageId);
            if (packagePurl) {
              scopePackages.add(packagePurl);
            }
          }
        }
      }

      const scopes: DependencyScope[] = Array.from(scopesMap.entries()).map(
        ([scopeName, packages]) => ({
          scope: scopeName,
          packages: Array.from(packages),
        }),
      );

      if (scopes.length > 0) {
        subprojects.push({
          purl: projectPurl,
          definitionFile,
          scopes,
        });
      }
    }
  }

  // Build relationships from dependency graph
  if (result.dependency_graphs) {
    for (const depGraph of Object.values(result.dependency_graphs)) {
      if (!depGraph.edges || depGraph.edges.length === 0) {
        continue;
      }

      for (const edge of depGraph.edges) {
        const fromNode = depGraph.nodes?.[edge.from];
        if (fromNode?.pkg === undefined) continue;
        const fromPackageId = depGraph.packages[fromNode.pkg];

        const toNode = depGraph.nodes?.[edge.to];
        if (toNode?.pkg === undefined) continue;
        const toPackageId = depGraph.packages[toNode.pkg];

        if (!fromPackageId || !toPackageId) {
          continue;
        }

        // Skip edges involving projects
        if (projectIds.has(fromPackageId) || projectIds.has(toPackageId)) {
          continue;
        }

        const fromPurl = packageIdToPurl.get(fromPackageId);
        const toPurl = packageIdToPurl.get(toPackageId);
        if (fromPurl && toPurl) {
          if (!relationshipsMap.has(fromPurl)) {
            relationshipsMap.set(fromPurl, new Set());
          }

          relationshipsMap.get(fromPurl)!.add(toPurl);
        }
      }
    }
  }

  if (result.issues) {
    for (const ortIssues of Object.values(result.issues)) {
      for (const ortIssue of ortIssues) {
        issues.push({
          code: ORT_EXTERNAL_ISSUE_CODE,
          message: ortIssue.message,
          severity: ortIssue.severity || "HINT",
          file: ortIssue.affectedPath,
        });
      }
    }
  }

  const packages: Package[] = Array.from(packageMap.values()).map(({ purl, evidence }) => ({
    purl,
    evidence: Array.from(evidence),
  }));

  const relationships: Relationship[] = Array.from(relationshipsMap.entries()).map(
    ([from, toSet]) => ({
      from,
      to: Array.from(toSet),
    }),
  );

  return {
    packages,
    subprojects,
    relationships,
    issues,
  };
}
