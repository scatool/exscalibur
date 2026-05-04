export interface VcpkgDependInfo {
  '?xml': Xml;
  DirectedGraph: DirectedGraph;
}

export interface Xml {
  version: string;
  encoding: string;
}

export interface DirectedGraph {
  Nodes: Nodes;
  Links: Links;
  xmlns: string;
}

export interface Links {
  Link: Link[];
}

export interface Link {
  Source: string;
  Target: string;
}

export interface Nodes {
  Node: Node[];
}

export interface Node {
  Id: string;
}
