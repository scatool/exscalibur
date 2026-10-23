export type {
  AnalyzerResultV2,
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
  JsonObject,
  JsonValue,
  PackageV2,
  PathCondition,
  ProjectReference,
  ReachableDeclaration,
  ResolvedDependency,
  SelectedVariant,
  SubprojectV2,
  UnresolvedDependency,
} from "./types.ts";
export { analyzerResultV2Schema, parseResultV2, validateResultV2 } from "./validate.ts";
export { createDependencyGraph, normalizeDependencyGraph, normalizeResultV2 } from "./normalize.ts";
export { createEmptyResultV2, mergeResultsV2 } from "./merge.ts";
export { queryDependenciesV2 } from "./query.ts";
export { filesExtractorV2 } from "./files-extractor.ts";
export type {
  ExtractionRuntimeOptionsV2,
  ExtractorV2,
  FileExtractionContextV2,
  FilesExtractorV2,
} from "./files-extractor.ts";
