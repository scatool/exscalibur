export interface ConanFileGraph {
  graph: Graph;
}

export type NodeId = string;

export interface Graph {
  nodes: Record<NodeId, Node>;
  root: Record<NodeId, string>;
  overrides: Record<string, unknown>;
  resolved_ranges: Record<string, unknown>;
  replaced_requires: Record<string, unknown>;
  error: unknown;
}

export type Recipe =
  | "Downloaded"
  | "Cache"
  | "Updated"
  | "Cache (Updated date)"
  | "Newer"
  | "Not in remote"
  | "Update available"
  | "Editable"
  | "Consumer"
  | "Cli"
  | "Platform";
export type Binary =
  | "Cache"
  | "Download"
  | "Update"
  | "Build"
  | "Missing"
  | "Skip"
  | "Editable"
  | "EditableBuild"
  | "Invalid"
  | "Platform";
export type Context = "host" | "build";

export interface Node {
  ref: string;
  id: NodeId;
  recipe: Recipe;
  package_id: string;
  prev: unknown;
  rrev: null | string;
  rrev_timestamp: null | number;
  prev_timestamp: unknown;
  remote: unknown;
  binary_remote: unknown;
  build_id: unknown;
  binary: Binary;
  invalid_build: boolean;
  info_invalid: unknown;
  name: null | string;
  user: null | string;
  channel: null | string;
  url: string;
  license: string;
  author: null | string;
  description: string;
  homepage: string;
  build_policy: unknown;
  upload_policy: unknown;
  revision_mode: string;
  provides: unknown;
  deprecated: unknown;
  win_bash: unknown;
  win_bash_run: unknown;
  default_options: null | Record<string, boolean>;
  options_description: unknown;
  version: null | string;
  topics: null | string[];
  package_type: string;
  languages: unknown[];
  settings: Record<string, string>;
  options: Record<string, string>;
  options_definitions: Record<string, string[]>;
  generators: unknown[];
  python_requires: unknown;
  system_requires: unknown;
  recipe_folder: string;
  source_folder: unknown;
  build_folder: unknown;
  generators_folder: unknown;
  package_folder: unknown;
  immutable_package_folder: unknown;
  cpp_info: Record<string, Cppinfo>;
  conf_info: unknown;
  label: string;
  info: Info;
  vendor: boolean;
  conandata: Conandata;
  dependencies: Record<NodeId, Dependency>;
  context: Context;
  test: boolean;
}

export interface Conandata {
  patches: Record<string, Patch>;
  sources: Record<string, Source>;
}

export interface Source {
  sha256: string;
  url: string[];
}

export interface Patch {
  patch_description: string;
  patch_file: string;
  patch_type: string;
}

export interface Cppinfo {
  includedirs: string[];
  srcdirs: unknown;
  libdirs: string[];
  resdirs: unknown;
  bindirs: string[];
  builddirs: unknown;
  frameworkdirs: unknown;
  system_libs: unknown;
  frameworks: unknown;
  libs: unknown;
  defines: unknown;
  cflags: unknown;
  cxxflags: unknown;
  sharedlinkflags: unknown;
  exelinkflags: unknown;
  objects: unknown;
  sources: unknown;
  sysroot: unknown;
  requires: unknown;
  properties: unknown;
  exe: unknown;
  type: unknown;
  location: unknown;
  link_location: unknown;
  languages: unknown;
}

export interface Dependency {
  ref: string;
  require: string;
  run: boolean;
  libs: boolean;
  skip: boolean;
  test: boolean;
  force: boolean;
  direct: boolean;
  build: boolean;
  transitive_headers: unknown;
  transitive_libs: unknown;
  headers: boolean;
  package_id_mode: string;
  visible: boolean;
}

export interface Info {
  settings: Record<string, string>;
  requires?: string[];
  options?: Record<string, string>;
}
