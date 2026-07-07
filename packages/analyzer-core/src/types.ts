import type { z } from "zod";

export type Package = {
  purl: string;
  evidence: string[];
};

export type DependencyScope = {
  scope: string;
  packages: string[];
};

export type Subproject = {
  purl: string;
  definitionFile: string;
  scopes: DependencyScope[];
};

export type Relationship = {
  from: string;
  to: string[];
};

export type IssueSeverity = "HINT" | "WARNING" | "ERROR";

export type Issue = {
  code: string;
  message: string;
  severity: IssueSeverity;
  file?: string;
};

export type AnalyzerResult = {
  packages: Package[];
  subprojects: Subproject[];
  relationships: Relationship[];
  issues: Issue[];
};

export type Extractor<Options = unknown> = {
  name: string;
  version: 1;
  extract: (codebase: string, options?: Partial<Options>) => Promise<AnalyzerResult>;

  /**
   * Function to provide dynamic default options for the extractor.
   * For static defaults, it's recommended to use the optionsSchema with .default() values instead.
   *
   * The default values returned will win over any defaults specified in the optionsSchema,
   * but will be overridden by any runtime options provided.
   */
  options?: () => Promise<Partial<Options>>;

  /**
   * Zod schema for validating and providing default options for the extractor.
   * If the extractor also provides an options function, the defaults from that function will take
   * precedence over the schema defaults.
   */
  optionsSchema?: z.ZodType<Options>;
};

export type MarkFileContext = {
  markFile: (file: string) => void;
};

export type FilesExtractor<Options = unknown> = {
  name: string;
  version: 1;
  markFiles: (this: MarkFileContext, codebase: string, options: Options) => Promise<void>;
  extractFile?: (file: string, options: Options) => Promise<AnalyzerResult>;

  /**
   * Function to provide dynamic default options for the extractor.
   * For static defaults, it's recommended to use the optionsSchema with .default() values instead.
   *
   * The default values returned will win over any defaults specified in the optionsSchema,
   * but will be overridden by any runtime options provided.
   */
  options?: () => Promise<Partial<Options>>;

  /**
   * Zod schema for validating and providing default options for the extractor.
   * If the extractor also provides an options function, the defaults from that function will take
   * precedence over the schema defaults.
   */
  optionsSchema?: z.ZodType<Options>;
};
