export interface OrtProject {
  id: string;
  definition_file_path: string;
  scope_names?: string[];
}

export interface OrtPackage {
  id: string;
  purl?: string;
}

interface OrtRootDependencyIndex {
  root: number;
  fragment?: string;
}

interface OrtDependencyGraphNode {
  pkg?: number;
  fragment?: number;
  linkage?: string;
  issues?: unknown[];
}

interface OrtDependencyGraphEdge {
  from: number;
  to: number;
}

export interface OrtDependencyGraph {
  packages: string[];
  scopes: Record<string, OrtRootDependencyIndex[]>;
  nodes: OrtDependencyGraphNode[];
  edges: OrtDependencyGraphEdge[];
}

export interface OrtIssue {
  timestamp: string;
  source: string;
  message: string;
  severity: 'HINT' | 'WARNING' | 'ERROR';
  affectedPath?: string;
}

export interface OrtAnalyzerResult {
  projects?: OrtProject[];
  packages?: OrtPackage[];
  dependency_graphs?: Record<string, OrtDependencyGraph>;
  issues?: Record<string, OrtIssue[]>;
}
