export type RustOptions = {
  /**
   * Glob patterns for files/directories to ignore during extraction.
   * Defaults to ['** /target/** '] (Cargo's build output directory).
   *
   * @example
   * ignore: ['** /target/** ', '** /vendor/** ']
   */
  ignore?: string[];
};
