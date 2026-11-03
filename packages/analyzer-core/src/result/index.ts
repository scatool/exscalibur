export type {
  AnalyzerResult,
  Artifact,
  Completeness,
  ConditionEvaluator,
  ConditionTruth,
  DependencyClosure,
  DependencyCondition,
  DependencyEdge,
  DependencyGraph,
  DependencyRequest,
  DependencyRoot,
  DependencyView,
  IdentityObservation,
  JsonObject,
  JsonValue,
  Package,
  PathCondition,
  ProjectReference,
  ReachableDeclaration,
  ResolvedDependency,
  SelectedVariant,
  Subproject,
  UnresolvedDependency,
} from "./types.ts";
export { analyzerResultSchema, parseResult, validateResult } from "./validate.ts";
export { createDependencyGraph, normalizeDependencyGraph, normalizeResult } from "./normalize.ts";
export { createEmptyResult, mergeResults } from "./merge.ts";
export { queryDependencies } from "./query.ts";
export { filesExtractor } from "./files-extractor.ts";
export type {
  ExtractionRuntimeOptions,
  Extractor,
  FileExtractionContext,
  FilesExtractor,
} from "./files-extractor.ts";

export { default as analyzerResultJsonSchema } from "./analyzer-result.schema.json" with { type: "json" };
