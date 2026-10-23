import { validateResult as validateCoreResult, type AnalyzerResult } from "@scatool/analyzer-core";

/** Use the authoritative contract; PURL equality does not imply equal project or view identity. */
export const validateResult = validateCoreResult;

/** Failed extraction is valid format data, but is not a successful fixture regression. */
export function assertSuccessfulResult(
  result: AnalyzerResult,
  allowedIssueCodes: readonly string[] = [],
): void {
  validateResult(result);
  const unexpected = result.issues.filter(
    (issue) => issue.severity === "ERROR" && !allowedIssueCodes.includes(issue.code),
  );
  if (unexpected.length > 0)
    throw new Error(
      `Unexpected extraction errors: ${unexpected.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
    );
}
