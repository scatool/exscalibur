import { parse as parseToml } from "smol-toml";
import type {
  AnalyzerResultV2,
  DependencyCondition,
  DependencyRequest,
  FileExtractionContextV2,
} from "@scatool/analyzer-core";
import { createPypiPurl } from "../python-utils.ts";
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

export function pipfileResult(content: string, context: FileExtractionContextV2): AnalyzerResultV2 {
  const native = readMetadataTable(JSON.parse(content));
  const observation = new PythonObservation(context, "pipfilelock", "locked");
  const project = observation.addProject();

  for (const scope of ["default", "develop"]) {
    if (native[scope] === undefined) continue;

    const root = observation.addRoot(project, `locked-group:${scope}`);
    for (const [name, entry] of Object.entries(readMetadataTable(native[scope]))) {
      const fields = readMetadataTable(entry);
      const version = optionalText(fields.version)?.match(/^==([^*=!<>~]+)$/)?.[1];
      const request = createDependencyRequest(optionalText(fields.version) ?? name, name, entry);
      const marker = optionalText(fields.markers);
      const condition: DependencyCondition | undefined = marker
        ? { language: "pep508", expression: marker }
        : undefined;

      if (!version) {
        observation.addDeclaration(root, request, condition);
        continue;
      }

      const purl = createPypiPurl(normalizePackageName(name), version);
      const id = JSON.stringify([scope, name]);
      if (!observation.result.packages.some((pkg) => pkg.purl === purl))
        observation.result.packages.push({ purl, evidence: [context.relativeFile] });
      observation.nodes.push({
        id,
        purl,
        dependencyCompleteness: "unknown",
        attributes: { "pipenv:record": toNativeJson(entry) },
      });
      observation.edges.push({
        from: root,
        to: id,
        status: "resolved",
        relation: "depends-on",
        ...(condition ? { selection: "conditional", condition } : { selection: "selected" }),
      });
    }
  }

  return observation.finish("unknown", { "pipenv:metadata": toNativeJson(native._meta ?? {}) });
}

export function lockResult(
  content: string,
  context: FileExtractionContextV2,
  kind: "poetrylock" | "pdmlock",
): AnalyzerResultV2 {
  const native = readMetadataTable(parseToml(content));
  const records = readMetadataList(native.package).map(readMetadataTable);
  const observation = new PythonObservation(context, kind, "locked");
  const project = observation.addProject();

  // Register every lock view before binding dependencies, including forward references.
  const viewsByPackageName = new Map<string, string[]>();
  const packageViewIds = records.map((record, index) => {
    const name = optionalText(record.name);
    const version = optionalText(record.version);
    if (!name || !version) throw new Error("Lock package requires name and version");

    const id = `package:${index}`;
    const purl = createPypiPurl(normalizePackageName(name), version);
    viewsByPackageName.set(normalizePackageName(name), [
      ...(viewsByPackageName.get(normalizePackageName(name)) ?? []),
      id,
    ]);
    if (!observation.result.packages.some((pkg) => pkg.purl === purl))
      observation.result.packages.push({ purl, evidence: [context.relativeFile] });
    observation.nodes.push({
      id,
      purl,
      locator: id,
      dependencyCompleteness: "complete",
      attributes: { "python:lockRecord": toNativeJson(record) },
    });

    const groups = Array.isArray(record.groups)
      ? record.groups
      : record.category
        ? [record.category]
        : [];
    const scopes = groups.length
      ? groups.map((value) => `locked-group:${String(value)}`)
      : ["locked-packages"];
    for (const scope of scopes) {
      const root = observation.addRoot(project, scope);
      const applicability = Object.fromEntries(
        ["markers", "marker", "python-versions", "requires_python", "requires-python", "optional"]
          .filter(
            (key) => record[key] !== undefined && record[key] !== false && record[key] !== "*",
          )
          .map((key) => [key, record[key]]),
      );
      const condition = Object.keys(applicability).length
        ? { language: `${kind}:package`, expression: toNativeJson(applicability) }
        : undefined;
      observation.edges.push({
        from: root,
        to: id,
        status: "resolved",
        relation: "depends-on",
        ...(condition ? { selection: "conditional", condition } : { selection: "selected" }),
      });
    }

    return id;
  });

  // A unique same-name view establishes a binding, not a solved version range.
  records.forEach((record, index) => {
    const dependencies = readLockDependencyRequests(record, kind);

    for (const request of dependencies) {
      if (request.name && normalizePackageName(request.name) === "python") continue;
      const candidateViewIds = request.name
        ? (viewsByPackageName.get(normalizePackageName(request.name)) ?? [])
        : [];
      const fields =
        typeof request.attributes?.["python:declaration"] === "object" &&
        !Array.isArray(request.attributes?.["python:declaration"])
          ? readMetadataTable(request.attributes?.["python:declaration"])
          : {};
      if (Array.isArray(fields.extras)) request.features = fields.extras.map(String);
      if (optionalText(fields.markers))
        request.condition = { language: "pep508", expression: String(fields.markers) };

      const exactVersion = request.specifier?.match(
        /^(?:[A-Za-z0-9._-]+(?:\[[^\]]*\])?\s*)?==([^;\s]+)(?:\s*;.*)?$/,
      )?.[1];
      const matchingViewIds = exactVersion
        ? candidateViewIds.filter(
            (id) => records[packageViewIds.indexOf(id)]!.version === exactVersion,
          )
        : candidateViewIds;
      const nativeSourceRequest =
        fields.git ||
        fields.path ||
        fields.url ||
        fields.source ||
        (kind === "pdmlock" && parseRequirementParts(request.specifier ?? "").directUrl);
      const targetViewId =
        matchingViewIds.length === 1 && !nativeSourceRequest ? matchingViewIds[0] : undefined;

      if (targetViewId) {
        const targetRecord = records[packageViewIds.indexOf(targetViewId)]!;
        const applicability = Object.fromEntries(
          ["markers", "marker", "python-versions", "requires_python", "requires-python"]
            .filter((key) => targetRecord[key] !== undefined && targetRecord[key] !== "*")
            .map((key) => [key, targetRecord[key]]),
        );
        const conditional =
          request.condition ||
          fields.optional ||
          fields.python ||
          fields.platform ||
          Object.keys(applicability).length > 0;
        const condition: DependencyCondition | undefined = conditional
          ? {
              language: `${kind}:binding`,
              expression: { request: toNativeJson(request), target: toNativeJson(applicability) },
            }
          : undefined;
        const hasSupportedVersionRequest =
          exactVersion ||
          request.specifier === "*" ||
          normalizePackageName(request.specifier?.split(";")[0]?.trim() ?? "") ===
            normalizePackageName(request.name ?? "");
        const selectionFacts = !hasSupportedVersionRequest
          ? { selection: "unknown" as const, ...(condition && { condition }) }
          : condition
            ? { selection: "conditional" as const, condition }
            : { selection: "selected" as const };

        observation.edges.push({
          from: packageViewIds[index]!,
          to: targetViewId,
          status: "resolved",
          relation: "depends-on",
          requested: request,
          ...(typeof fields.optional === "boolean" && { optional: fields.optional }),
          ...selectionFacts,
        });
      } else {
        observation.edges.push({
          from: packageViewIds[index]!,
          status: "unresolved",
          relation: "depends-on",
          ...(request.condition
            ? { selection: "conditional", condition: request.condition }
            : { selection: "unknown" }),
          requested: request,
          attributes: { "python:candidateViews": candidateViewIds },
        });
      }
    }
  });

  return observation.finish("unknown", {
    "python:lockMetadata": toNativeJson(native.metadata ?? {}),
  });
}

function readLockDependencyRequests(
  record: Record<string, unknown>,
  kind: "poetrylock" | "pdmlock",
): DependencyRequest[] {
  if (kind === "pdmlock") {
    return readMetadataList(record.dependencies).map((spec) => {
      if (typeof spec !== "string") throw new Error("Expected PDM dependency string");
      return createDependencyRequest(spec);
    });
  }

  return Object.entries(readMetadataTable(record.dependencies)).flatMap(([name, spec]) =>
    (Array.isArray(spec) ? spec : [spec]).map((item) =>
      createDependencyRequest(
        typeof item === "string" ? item : (optionalText(readMetadataTable(item).version) ?? "*"),
        name,
        item,
      ),
    ),
  );
}
