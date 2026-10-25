import { parse as parseToml } from "smol-toml";
import type {
  AnalyzerResultV2,
  DependencyCondition,
  FileExtractionContextV2,
  JsonValue,
} from "@scatool/analyzer-core";
import { PythonObservation } from "./observation.ts";
import {
  createDependencyRequest,
  normalizePackageName,
  optionalText,
  parseRequirementParts,
  readMetadataList,
  readMetadataTable,
  toNativeJson,
} from "./native-metadata.ts";

export function requirementsResult(
  content: string,
  context: FileExtractionContextV2,
): AnalyzerResultV2 {
  const observation = new PythonObservation(context, "requirementstxt", "declared");
  const root = observation.addRoot(observation.addProject(), "requirements");

  if (content.includes(`${String.fromCharCode(27)}[`))
    throw new Error("ANSI escape sequences prevent reliable requirements parsing");

  const lines = content.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (const line of lines) {
    const spec = line.replace(/\s+#.*$/, "").trim();
    if (!spec || spec.startsWith("#")) continue;

    if (/^(?:-r|--requirement|-c|--constraint)(?:\s|=|\S)/.test(spec)) {
      observation.addIssue(
        "include_not_followed",
        `Requirement/constraint input is not followed: ${spec}`,
      );
      observation.nodes[0]!.dependencyCompleteness = "partial";
      observation.edges.push({
        from: root,
        status: "unresolved",
        relation: /^(?:-c|--constraint)/.test(spec) ? "constrains" : "depends-on",
        selection: "unknown",
        requested: { specifier: spec },
      });
      continue;
    }

    if (spec.startsWith("-") && !/^(-e\s|--editable(?:\s|=))/.test(spec)) {
      observation.addIssue("option_preserved", `Non-package requirement option preserved: ${spec}`);
      observation.nodes[0]!.attributes = {
        ...(observation.nodes[0]!.attributes ?? {}),
        "python:options": [
          ...((observation.nodes[0]!.attributes?.["python:options"] as JsonValue[]) ?? []),
          spec,
        ],
      };
      continue;
    }

    // An egg fragment supplies a legacy unnamed URL's name, never overrides the
    // explicit name/extras of a PEP 508 direct reference.
    const egg = parseRequirementParts(spec).directUrl
      ? undefined
      : spec.match(/[?#&]egg=([^&\s]+)/)?.[1];
    const request = createDependencyRequest(spec, egg ? decodeURIComponent(egg) : undefined);
    if (/^(?:[a-z]+:\/\/|(?:git|hg|svn|bzr)\+)/i.test(spec)) delete request.name;
    observation.addDeclaration(root, request);
  }

  return observation.finish();
}

export function pyprojectResult(
  content: string,
  context: FileExtractionContextV2,
): AnalyzerResultV2 {
  const native = readMetadataTable(parseToml(content));
  const project = readMetadataTable(native.project);
  const tool = readMetadataTable(native.tool);
  const poetry = readMetadataTable(tool.poetry);
  const observation = new PythonObservation(context, "pyprojecttoml", "declared");
  const subject = observation.addProject(
    optionalText(project.name) ?? optionalText(poetry.name),
    optionalText(project.version) ?? optionalText(poetry.version),
  );

  const addRequirementList = (scope: string, value: unknown) => {
    const from = observation.addRoot(subject, scope);
    for (const entry of readMetadataList(value)) {
      if (typeof entry === "string")
        observation.addDeclaration(from, createDependencyRequest(entry));
      else {
        observation.addDeclaration(
          from,
          { attributes: { "python:declaration": toNativeJson(entry) } },
          undefined,
          "group-include",
        );
        observation.addIssue(
          "group_include_unexpanded",
          "Dependency group includes are preserved without expansion",
        );
      }
    }
  };

  const addPoetryTable = (scope: string, value: unknown) => {
    const from = observation.addRoot(subject, scope);
    for (const [name, entry] of Object.entries(readMetadataTable(value))) {
      if (normalizePackageName(name) === "python") {
        observation.nodes.find((node) => node.id === from)!.attributes = {
          "python:requiresPython": toNativeJson(entry),
        };
        continue;
      }

      for (const alternative of Array.isArray(entry) ? entry : [entry]) {
        const fields = typeof alternative === "string" ? {} : readMetadataTable(alternative);
        const spec =
          typeof alternative === "string" ? alternative : (optionalText(fields.version) ?? "*");
        const request = createDependencyRequest(spec, name, alternative);
        if (Array.isArray(fields.extras))
          request.features = fields.extras.map((item) => String(item));
        const condition: DependencyCondition | undefined =
          fields.markers || fields.python || fields.platform || fields.optional
            ? { language: "poetry:dependency", expression: toNativeJson(alternative) }
            : undefined;
        observation.addDeclaration(
          from,
          request,
          condition,
          "dependency",
          typeof fields.optional === "boolean" ? fields.optional : undefined,
        );
      }
    }
  };

  // Keep each native declaration family in its own reported scope.
  if (project.dependencies !== undefined) addRequirementList("dependencies", project.dependencies);
  for (const [scope, specs] of Object.entries(readMetadataTable(project["optional-dependencies"])))
    addRequirementList(`optional.${scope}`, specs);

  if (poetry.dependencies !== undefined) addPoetryTable("dependencies", poetry.dependencies);
  if (poetry["dev-dependencies"] !== undefined)
    addPoetryTable("dev-dependencies", poetry["dev-dependencies"]);
  for (const [scope, group] of Object.entries(readMetadataTable(poetry.group)))
    addPoetryTable(`group.${scope}`, readMetadataTable(group).dependencies);

  for (const [scope, specs] of Object.entries(
    readMetadataTable(readMetadataTable(tool.pdm)["dev-dependencies"]),
  ))
    addRequirementList(scope === "dev" ? "dev-dependencies" : `group.${scope}`, specs);
  if (readMetadataTable(tool.uv)["dev-dependencies"] !== undefined)
    addRequirementList("dev-dependencies", readMetadataTable(tool.uv)["dev-dependencies"]);
  for (const [scope, specs] of Object.entries(readMetadataTable(native["dependency-groups"])))
    addRequirementList(scope === "dev" ? "dev-dependencies" : `group.${scope}`, specs);

  if (observation.roots.length === 0) observation.addRoot(subject, "dependencies");

  // A build-system table or an unsupported backend's metadata cannot establish
  // that runtime dependencies (or additional scopes) are absent.
  const unsupportedProjectMetadata = native.project === undefined && tool.poetry === undefined;
  if (unsupportedProjectMetadata) {
    const root = observation.addRoot(subject, "dependencies");
    observation.nodes.find((node) => node.id === root)!.dependencyCompleteness = "unknown";
    observation.addIssue(
      "unsupported_project_metadata",
      "No supported project metadata table establishes runtime dependency coverage",
    );
  }

  const dynamic = readMetadataList(project.dynamic);
  if (dynamic.includes("dependencies") || dynamic.includes("optional-dependencies")) {
    observation.addIssue(
      "dynamic_dependencies",
      "Dynamic dependency metadata has not been resolved",
    );
    if (dynamic.includes("dependencies")) {
      const root = observation.addRoot(subject, "dependencies");
      observation.nodes.find((node) => node.id === root)!.dependencyCompleteness = "unknown";
    }
    if (dynamic.includes("optional-dependencies"))
      for (const root of observation.roots.filter((entry) => entry.scope.startsWith("optional.")))
        observation.nodes.find((node) => node.id === root.node)!.dependencyCompleteness = "unknown";
  }

  return observation.finish(
    unsupportedProjectMetadata || dynamic.includes("optional-dependencies")
      ? "unknown"
      : "complete",
    {
      "python:manifest": toNativeJson(native),
    },
  );
}
