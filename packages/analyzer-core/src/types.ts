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

export type IssueSeverity = 'HINT' | 'WARNING' | 'ERROR';

export type Issue = {
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
  options?: () => Promise<Options>;
};

export type MarkFileContext = {
  markFile: (file: string) => void;
};

export type FilesExtractor<Options = unknown> = {
  name: string;
  version: 1;
  markFiles: (this: MarkFileContext, codebase: string, options: Options) => Promise<void>;
  extractFile?: (file: string, options: Options) => Promise<AnalyzerResult>;
  options?: () => Promise<Options>;
};
