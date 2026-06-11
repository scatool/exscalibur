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
  error: null | unknown;
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
  prev: null | unknown;
  rrev: null | string;
  rrev_timestamp: null | number;
  prev_timestamp: null | unknown;
  remote: null | unknown;
  binary_remote: null | unknown;
  build_id: null | unknown;
  binary: Binary;
  invalid_build: boolean;
  info_invalid: null | unknown;
  name: null | string;
  user: null | string;
  channel: null | string;
  url: string;
  license: string;
  author: null | string;
  description: string;
  homepage: string;
  build_policy: null | unknown;
  upload_policy: null | unknown;
  revision_mode: string;
  provides: null | unknown;
  deprecated: null | unknown;
  win_bash: null | unknown;
  win_bash_run: null | unknown;
  default_options: null | Record<string, boolean>;
  options_description: null | unknown;
  version: null | string;
  topics: null | string[];
  package_type: string;
  languages: unknown[];
  settings: Record<string, string>;
  options: Record<string, string>;
  options_definitions: Record<string, string[]>;
  generators: unknown[];
  python_requires: null | unknown;
  system_requires: unknown;
  recipe_folder: string;
  source_folder: null | unknown;
  build_folder: null | unknown;
  generators_folder: null | unknown;
  package_folder: null | unknown;
  immutable_package_folder: null | unknown;
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
  srcdirs: null | unknown;
  libdirs: string[];
  resdirs: null | unknown;
  bindirs: string[];
  builddirs: null | unknown;
  frameworkdirs: null | unknown;
  system_libs: null | unknown;
  frameworks: null | unknown;
  libs: null | unknown;
  defines: null | unknown;
  cflags: null | unknown;
  cxxflags: null | unknown;
  sharedlinkflags: null | unknown;
  exelinkflags: null | unknown;
  objects: null | unknown;
  sources: null | unknown;
  sysroot: null | unknown;
  requires: null | unknown;
  properties: null | unknown;
  exe: null | unknown;
  type: null | unknown;
  location: null | unknown;
  link_location: null | unknown;
  languages: null | unknown;
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
  transitive_headers: null | unknown;
  transitive_libs: null | unknown;
  headers: boolean;
  package_id_mode: string;
  visible: boolean;
}

export interface Info {
  settings: Record<string, string>;
  requires?: string[];
  options?: Record<string, string>;
}
