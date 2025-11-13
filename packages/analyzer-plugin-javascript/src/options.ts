/**
 * Shared options for JavaScript ecosystem extractors.
 */
export interface JavaScriptOptions {
  /**
   * Array of glob patterns to ignore when scanning for lockfiles/package files.
   * Files matching any of these patterns will be excluded from extraction.
   */
  ignore?: string[];
}
