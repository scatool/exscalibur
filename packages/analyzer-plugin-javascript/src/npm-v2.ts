// Keep the shared adapter entry point stable while separating graph construction from
// auxiliary manifest ingestion. Native adapters still own dependency target selection.
export { NpmGraphV2, json, type NpmProject, type NpmRecord } from "./npm-graph.ts";
export {
  addManifestObservation,
  addCurrentManifestObservation,
  assertPortableManifest,
  dependencyScopes,
  loadNpmManifest,
  table,
  type NpmDeclaration,
} from "./npm-manifest.ts";
