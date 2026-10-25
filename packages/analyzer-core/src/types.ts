export type ExternalReferenceType = "vcs" | "sourceArtifact";

export type ExternalReference = {
  type: ExternalReferenceType;
  locator: string;
};

export type IssueSeverity = "HINT" | "WARNING" | "ERROR";

export type Issue = {
  code: string;
  message: string;
  severity: IssueSeverity;
  file?: string;
};

export type MarkFileContext = {
  markFile: (file: string) => void;
  globalIgnorePatterns?: string[];
};
