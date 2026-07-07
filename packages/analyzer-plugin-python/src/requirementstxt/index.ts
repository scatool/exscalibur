import {
  type AnalyzerResult,
  type Extractor,
  type Issue,
  filesExtractor,
  scanAndMarkFiles,
  ensurePackageExists,
  buildResult,
  initializeExtractionMaps,
  readNormalizedTextFile,
} from "@scatool/analyzer-core";
import { createPypiPurl, parsePythonDependencyName } from "../python-utils.ts";
import type { PythonOptions } from "../options.ts";
import { optionSchema } from "../options.ts";

export const extractor: Extractor<PythonOptions> = filesExtractor<PythonOptions>({
  name: "requirementstxt",
  version: 1,
  optionsSchema: optionSchema,
  markFiles: async function (codebase: string, options: PythonOptions) {
    await scanAndMarkFiles(this, codebase, "**/requirements*.txt", options.ignore);
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await readNormalizedTextFile(file);
    const lines = content.split("\n");

    const { packageMap, relationshipsMap } = initializeExtractionMaps();
    if (hasAnsiEscapeSequences(content)) {
      return buildResult(packageMap, relationshipsMap, []);
    }

    const issues: Issue[] = [];
    let emittedPackage = false;

    const addDependency = (name: string, lineNumber: number) => {
      const purl = createPypiPurl(name);
      ensurePackageExists(packageMap, purl);
      emittedPackage = true;
      packageMap.get(purl)!.evidence.add(`${file}#${lineNumber}`);
    };

    // Parse requirements.txt
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith("#") || trimmed === "") continue;

      if (isRequirementInclude(trimmed)) {
        issues.push({
          code: "requirementstxt.include_not_followed",
          severity: "WARNING",
          message:
            "requirements.txt include directives are not followed; dependencies from the referenced file may be missing.",
          file: `${file}#${i + 1}`,
        });
        continue;
      }

      if (isEditableRequirement(trimmed)) {
        const eggName = parseEggName(trimmed);
        if (eggName) {
          addDependency(eggName, i + 1);
        } else {
          issues.push({
            code: "requirementstxt.unsupported_editable_dependency_declaration",
            severity: "WARNING",
            message: `Unsupported editable requirements.txt dependency declaration was not emitted: ${trimmed}`,
            file: `${file}#${i + 1}`,
          });
        }
        continue;
      }

      // Skip non-package options like --index-url.
      if (trimmed.startsWith("-")) continue;

      // Parse dependency specification
      const dep = parseDependency(trimmed);
      if (!dep) {
        const eggName = parseEggName(trimmed);
        if (eggName) {
          addDependency(eggName, i + 1);
          continue;
        }

        issues.push({
          code: "requirementstxt.unsupported_dependency_declaration",
          severity: "WARNING",
          message: `Unsupported requirements.txt dependency declaration was not emitted: ${trimmed}`,
          file: `${file}#${i + 1}`,
        });
        continue;
      }

      addDependency(dep, i + 1);
    }

    // Note: requirements.txt files don't define subprojects
    // They only list packages without project metadata
    // Therefore, we don't create subprojects for requirements.txt files

    return buildResult(
      packageMap,
      relationshipsMap,
      [],
      emittedPackage
        ? [
            {
              code: "requirementstxt.unresolved_dependencies",
              severity: "WARNING",
              message:
                "requirements.txt dependencies are unresolved and emitted as versionless PyPI PURLs. Use a lockfile for resolved versions and transitive relationships.",
              file,
            },
            ...issues,
          ]
        : issues,
    );
  },
});

/**
 * Parse a dependency line from requirements.txt
 * Supports formats like:
 * - package-name==1.2.3
 * - package-name>=1.2.3
 * - package-name
 * - package-name[extra]==1.2.3
 */
function parseDependency(line: string): string | null {
  line = line.trim();
  if (!line) return null;

  // Remove inline comments
  const commentIndex = line.indexOf("#");
  if (commentIndex !== -1) {
    line = line.substring(0, commentIndex).trim();
  }

  if (!line) return null;

  // Skip unnamed URLs and VCS references.
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|(?:git|hg|svn|bzr)\+)/.test(line)) {
    return null;
  }

  return parsePythonDependencyName(line);
}

function isRequirementInclude(line: string): boolean {
  return /^(-r|--requirement)\b/.test(line);
}

function isEditableRequirement(line: string): boolean {
  return /^(-e|--editable)\b/.test(line);
}

function parseEggName(line: string): string | null {
  const match = line.match(/[?#&]egg=([^&\s]+)/);
  return match ? parsePythonDependencyName(decodeURIComponent(match[1])) : null;
}

function hasAnsiEscapeSequences(content: string): boolean {
  const escape = String.fromCharCode(27);
  return content.includes(`${escape}[`);
}
