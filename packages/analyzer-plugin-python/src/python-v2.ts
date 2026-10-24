import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PackageURL } from "packageurl-js";
import { parse as parseToml } from "smol-toml";
import {
  createDependencyGraph,
  createEmptyResultV2,
  filesExtractorV2,
  mergeResultsV2,
  normalizeResultV2,
  readNormalizedTextFile,
  scanAndMarkFiles,
  type AnalyzerResultV2,
  type DependencyCondition,
  type DependencyEdge,
  type DependencyRequest,
  type DependencyView,
  type FileExtractionContextV2,
  type JsonObject,
  type JsonValue,
} from "@scatool/analyzer-core";
import { optionSchema, type PythonOptions } from "./options.ts";
import { createPypiPurl } from "./python-utils.ts";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Python metadata table");
  return value as RecordValue;
};
const array = (value: unknown): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Expected a Python metadata list");
  return value;
};
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const normalizedName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** Read PEP 508 lexical boundaries, without solving version or marker expressions.
 * The grammar permits WS around extras. After @, URL consumes every non-space/tab
 * character (including semicolons); only a following WS can introduce its marker.
 * Keep this separate from Poetry/Pipfile's named native version values.
 */
function requirementParts(spec: string): {
  name?: string;
  features?: string[];
  marker?: string;
  directUrl?: boolean;
} {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]*\b/;
  let remaining = spec.replace(/^[ \t]+/, "");
  const name = remaining.match(identifier)?.[0];
  if (!name) return {};
  remaining = remaining.slice(name.length).replace(/^[ \t]+/, "");
  let features: string[] | undefined;
  if (remaining.startsWith("[")) {
    const end = remaining.indexOf("]");
    if (end === -1) return { name };
    const extras = remaining.slice(1, end).trim();
    features = extras ? extras.split(",").map((extra) => extra.trim()) : [];
    if (features.some((extra) => extra.match(identifier)?.[0] !== extra)) return { name };
    remaining = remaining.slice(end + 1).replace(/^[ \t]+/, "");
  }
  const header = { name, ...(features?.length && { features }) };
  if (remaining.startsWith("@")) {
    remaining = remaining.slice(1).replace(/^[ \t]+/, "");
    const url = remaining.match(/^[^ \t]+/)?.[0];
    if (!url) return header;
    const marker = remaining
      .slice(url.length)
      .match(/^[ \t]+;[ \t]*(.*)$/s)?.[1]
      .trim();
    return { ...header, directUrl: true, ...(marker && { marker }) };
  }
  // Bare URLs and requirements-file extensions are not named PEP 508 versions.
  if (remaining && !/^(?:[<>=!~(;])/.test(remaining)) return header;
  const semicolon = remaining.indexOf(";");
  const marker = semicolon === -1 ? undefined : remaining.slice(semicolon + 1).trim();
  return { ...header, ...(marker && { marker }) };
}

function request(spec: string, name?: string, details?: unknown): DependencyRequest {
  const parsed = name === undefined ? requirementParts(spec) : {};
  const parsedName = name ?? parsed.name;
  return {
    ...(parsedName && { name: parsedName }),
    specifier: spec,
    ...(parsed.features && { features: parsed.features }),
    ...(parsed.marker && { condition: { language: "pep508", expression: parsed.marker } }),
    ...(details !== undefined && { attributes: { "python:declaration": json(details) } }),
  };
}

class Observation {
  readonly result: AnalyzerResultV2;
  readonly nodes: DependencyView[] = [];
  readonly edges: DependencyEdge[] = [];
  readonly roots: {
    id: string;
    project: { purl: string; definitionFile: string };
    scope: string;
    node: string;
  }[] = [];
  constructor(
    readonly context: FileExtractionContextV2,
    readonly extractor: string,
    readonly interpretation: "declared" | "locked",
  ) {
    this.result = createEmptyResultV2(context.codebaseId);
  }
  project(name?: string, version?: string) {
    const purl = name
      ? createPypiPurl(normalizedName(name), version)
      : new PackageURL(
          "generic",
          "python-input",
          createHash("sha256")
            .update(JSON.stringify([this.context.codebaseId, this.context.relativeFile]))
            .digest("hex"),
          null,
          null,
          null,
        ).toString();
    const project = { purl, definitionFile: this.context.relativeFile };
    this.result.subprojects.push({
      ...project,
      evidence: [this.context.relativeFile],
      identityObservations: [
        {
          source: { extractor: this.extractor, files: [this.context.relativeFile] },
          synthesizedPurl: !name,
        },
      ],
    });
    return project;
  }
  root(project: { purl: string; definitionFile: string }, scope: string) {
    const id = `scope:${JSON.stringify(scope)}`;
    if (!this.nodes.some((node) => node.id === id)) {
      this.nodes.push({ id, purl: project.purl, project, dependencyCompleteness: "complete" });
      this.roots.push({ id, project, scope, node: id });
    }
    return id;
  }
  declaration(
    from: string,
    requested: DependencyRequest,
    condition = requested.condition,
    kind = "dependency",
    optional?: boolean,
  ) {
    this.edges.push({
      from,
      status: "declared",
      relation: "depends-on",
      requested,
      kind,
      ...(optional !== undefined && { optional }),
      ...(condition ? { selection: "conditional", condition } : { selection: "selected" }),
      evidence: [this.context.relativeFile],
    });
  }
  issue(code: string, message: string) {
    this.result.issues.push({
      code: `${this.extractor}.${code}`,
      message,
      severity: "WARNING",
      file: this.context.relativeFile,
    });
  }
  finish(rootCompleteness: "complete" | "unknown" = "complete", attributes?: JsonObject) {
    this.result.graphs.push(
      createDependencyGraph({
        source: { extractor: this.extractor, files: [this.context.relativeFile] },
        interpretation: this.interpretation,
        rootCompleteness,
        roots: this.roots,
        nodes: this.nodes,
        edges: this.edges,
        ...(attributes && { attributes }),
      }),
    );
    return normalizeResultV2(this.result);
  }
}

export function requirementsResult(
  content: string,
  context: FileExtractionContextV2,
): AnalyzerResultV2 {
  const out = new Observation(context, "requirementstxt", "declared");
  const root = out.root(out.project(), "requirements");
  if (content.includes(`${String.fromCharCode(27)}[`))
    throw new Error("ANSI escape sequences prevent reliable requirements parsing");
  const lines = content.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  for (const line of lines) {
    const spec = line.replace(/\s+#.*$/, "").trim();
    if (!spec || spec.startsWith("#")) continue;
    if (/^(?:-r|--requirement|-c|--constraint)(?:\s|=|\S)/.test(spec)) {
      out.issue("include_not_followed", `Requirement/constraint input is not followed: ${spec}`);
      out.nodes[0]!.dependencyCompleteness = "partial";
      out.edges.push({
        from: root,
        status: "unresolved",
        relation: /^(?:-c|--constraint)/.test(spec) ? "constrains" : "depends-on",
        selection: "unknown",
        requested: { specifier: spec },
      });
      continue;
    }
    if (spec.startsWith("-") && !/^(-e\s|--editable(?:\s|=))/.test(spec)) {
      out.issue("option_preserved", `Non-package requirement option preserved: ${spec}`);
      out.nodes[0]!.attributes = {
        ...(out.nodes[0]!.attributes ?? {}),
        "python:options": [
          ...((out.nodes[0]!.attributes?.["python:options"] as JsonValue[]) ?? []),
          spec,
        ],
      };
      continue;
    }
    // An egg fragment supplies a legacy unnamed URL's name, never overrides the
    // explicit name/extras of a PEP 508 direct reference.
    const egg = requirementParts(spec).directUrl
      ? undefined
      : spec.match(/[?#&]egg=([^&\s]+)/)?.[1];
    const req = request(spec, egg ? decodeURIComponent(egg) : undefined);
    if (/^(?:[a-z]+:\/\/|(?:git|hg|svn|bzr)\+)/i.test(spec)) delete req.name;
    out.declaration(root, req);
  }
  return out.finish();
}

export function pyprojectResult(
  content: string,
  context: FileExtractionContextV2,
): AnalyzerResultV2 {
  const native = object(parseToml(content));
  const project = object(native.project),
    tool = object(native.tool),
    poetry = object(tool.poetry);
  const out = new Observation(context, "pyprojecttoml", "declared");
  const subject = out.project(
    text(project.name) ?? text(poetry.name),
    text(project.version) ?? text(poetry.version),
  );
  const list = (scope: string, value: unknown) => {
    const from = out.root(subject, scope);
    for (const entry of array(value)) {
      if (typeof entry === "string") out.declaration(from, request(entry));
      else {
        out.declaration(
          from,
          { attributes: { "python:declaration": json(entry) } },
          undefined,
          "group-include",
        );
        out.issue(
          "group_include_unexpanded",
          "Dependency group includes are preserved without expansion",
        );
      }
    }
  };
  const table = (scope: string, value: unknown) => {
    const from = out.root(subject, scope);
    for (const [name, entry] of Object.entries(object(value))) {
      if (normalizedName(name) === "python") {
        out.nodes.find((node) => node.id === from)!.attributes = {
          "python:requiresPython": json(entry),
        };
        continue;
      }
      for (const alternative of Array.isArray(entry) ? entry : [entry]) {
        const fields = typeof alternative === "string" ? {} : object(alternative);
        const spec = typeof alternative === "string" ? alternative : (text(fields.version) ?? "*");
        const req = request(spec, name, alternative);
        if (Array.isArray(fields.extras)) req.features = fields.extras.map((item) => String(item));
        const condition: DependencyCondition | undefined =
          fields.markers || fields.python || fields.platform || fields.optional
            ? { language: "poetry:dependency", expression: json(alternative) }
            : undefined;
        out.declaration(
          from,
          req,
          condition,
          "dependency",
          typeof fields.optional === "boolean" ? fields.optional : undefined,
        );
      }
    }
  };
  if (project.dependencies !== undefined) list("dependencies", project.dependencies);
  for (const [scope, specs] of Object.entries(object(project["optional-dependencies"])))
    list(`optional.${scope}`, specs);
  if (poetry.dependencies !== undefined) table("dependencies", poetry.dependencies);
  if (poetry["dev-dependencies"] !== undefined)
    table("dev-dependencies", poetry["dev-dependencies"]);
  for (const [scope, group] of Object.entries(object(poetry.group)))
    table(`group.${scope}`, object(group).dependencies);
  for (const [scope, specs] of Object.entries(object(object(tool.pdm)["dev-dependencies"])))
    list(scope === "dev" ? "dev-dependencies" : `group.${scope}`, specs);
  if (object(tool.uv)["dev-dependencies"] !== undefined)
    list("dev-dependencies", object(tool.uv)["dev-dependencies"]);
  for (const [scope, specs] of Object.entries(object(native["dependency-groups"])))
    list(scope === "dev" ? "dev-dependencies" : `group.${scope}`, specs);
  if (out.roots.length === 0) out.root(subject, "dependencies");
  // A build-system table or an unsupported backend's metadata cannot establish
  // that runtime dependencies (or additional scopes) are absent.
  const unsupportedProjectMetadata = native.project === undefined && tool.poetry === undefined;
  if (unsupportedProjectMetadata) {
    const root = out.root(subject, "dependencies");
    out.nodes.find((node) => node.id === root)!.dependencyCompleteness = "unknown";
    out.issue(
      "unsupported_project_metadata",
      "No supported project metadata table establishes runtime dependency coverage",
    );
  }
  const dynamic = array(project.dynamic);
  if (dynamic.includes("dependencies") || dynamic.includes("optional-dependencies")) {
    out.issue("dynamic_dependencies", "Dynamic dependency metadata has not been resolved");
    if (dynamic.includes("dependencies")) {
      const root = out.root(subject, "dependencies");
      out.nodes.find((node) => node.id === root)!.dependencyCompleteness = "unknown";
    }
    if (dynamic.includes("optional-dependencies"))
      for (const root of out.roots.filter((entry) => entry.scope.startsWith("optional.")))
        out.nodes.find((node) => node.id === root.node)!.dependencyCompleteness = "unknown";
  }
  return out.finish(
    unsupportedProjectMetadata || dynamic.includes("optional-dependencies")
      ? "unknown"
      : "complete",
    {
      "python:manifest": json(native),
    },
  );
}

export function pipfileResult(content: string, context: FileExtractionContextV2): AnalyzerResultV2 {
  const native = object(JSON.parse(content));
  const out = new Observation(context, "pipfilelock", "locked");
  const project = out.project();
  for (const scope of ["default", "develop"]) {
    if (native[scope] === undefined) continue;
    const root = out.root(project, `locked-group:${scope}`);
    for (const [name, entry] of Object.entries(object(native[scope]))) {
      const fields = object(entry);
      const version = text(fields.version)?.match(/^==([^*=!<>~]+)$/)?.[1];
      const req = request(text(fields.version) ?? name, name, entry);
      const marker = text(fields.markers);
      const condition: DependencyCondition | undefined = marker
        ? { language: "pep508", expression: marker }
        : undefined;
      if (!version) {
        out.declaration(root, req, condition);
        continue;
      }
      const purl = createPypiPurl(normalizedName(name), version),
        id = JSON.stringify([scope, name]);
      if (!out.result.packages.some((pkg) => pkg.purl === purl))
        out.result.packages.push({ purl, evidence: [context.relativeFile] });
      out.nodes.push({
        id,
        purl,
        dependencyCompleteness: "unknown",
        attributes: { "pipenv:record": json(entry) },
      });
      out.edges.push({
        from: root,
        to: id,
        status: "resolved",
        relation: "depends-on",
        ...(condition ? { selection: "conditional", condition } : { selection: "selected" }),
      });
    }
  }
  return out.finish("unknown", { "pipenv:metadata": json(native._meta ?? {}) });
}

export function lockResult(
  content: string,
  context: FileExtractionContextV2,
  kind: "poetrylock" | "pdmlock",
): AnalyzerResultV2 {
  const native = object(parseToml(content));
  const records = array(native.package).map(object);
  const out = new Observation(context, kind, "locked");
  const project = out.project();
  const names = new Map<string, string[]>();
  const ids = records.map((record, index) => {
    const name = text(record.name),
      version = text(record.version);
    if (!name || !version) throw new Error("Lock package requires name and version");
    const id = `package:${index}`,
      purl = createPypiPurl(normalizedName(name), version);
    names.set(normalizedName(name), [...(names.get(normalizedName(name)) ?? []), id]);
    if (!out.result.packages.some((pkg) => pkg.purl === purl))
      out.result.packages.push({ purl, evidence: [context.relativeFile] });
    out.nodes.push({
      id,
      purl,
      locator: id,
      dependencyCompleteness: "complete",
      attributes: { "python:lockRecord": json(record) },
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
      const root = out.root(project, scope);
      const applicability = Object.fromEntries(
        ["markers", "marker", "python-versions", "requires_python", "requires-python", "optional"]
          .filter(
            (key) => record[key] !== undefined && record[key] !== false && record[key] !== "*",
          )
          .map((key) => [key, record[key]]),
      );
      const condition = Object.keys(applicability).length
        ? { language: `${kind}:package`, expression: json(applicability) }
        : undefined;
      out.edges.push({
        from: root,
        to: id,
        status: "resolved",
        relation: "depends-on",
        ...(condition ? { selection: "conditional", condition } : { selection: "selected" }),
      });
    }
    return id;
  });
  records.forEach((record, index) => {
    const dependencies: DependencyRequest[] =
      kind === "pdmlock"
        ? array(record.dependencies).map((spec) => {
            if (typeof spec !== "string") throw new Error("Expected PDM dependency string");
            return request(spec);
          })
        : Object.entries(object(record.dependencies)).flatMap(([name, spec]) =>
            (Array.isArray(spec) ? spec : [spec]).map((item) =>
              request(
                typeof item === "string" ? item : (text(object(item).version) ?? "*"),
                name,
                item,
              ),
            ),
          );
    for (const req of dependencies) {
      if (req.name && normalizedName(req.name) === "python") continue;
      const candidates = req.name ? (names.get(normalizedName(req.name)) ?? []) : [];
      const fields =
        typeof req.attributes?.["python:declaration"] === "object" &&
        !Array.isArray(req.attributes?.["python:declaration"])
          ? object(req.attributes?.["python:declaration"])
          : {};
      if (Array.isArray(fields.extras)) req.features = fields.extras.map(String);
      if (text(fields.markers))
        req.condition = { language: "pep508", expression: String(fields.markers) };
      const exact = req.specifier?.match(
        /^(?:[A-Za-z0-9._-]+(?:\[[^\]]*\])?\s*)?==([^;\s]+)(?:\s*;.*)?$/,
      )?.[1];
      const matching = exact
        ? candidates.filter((id) => records[ids.indexOf(id)]!.version === exact)
        : candidates;
      const nativeSourceRequest =
        fields.git ||
        fields.path ||
        fields.url ||
        fields.source ||
        (kind === "pdmlock" && requirementParts(req.specifier ?? "").directUrl);
      const target = matching.length === 1 && !nativeSourceRequest ? matching[0] : undefined;
      if (target) {
        const targetRecord = records[ids.indexOf(target)]!;
        const applicability = Object.fromEntries(
          ["markers", "marker", "python-versions", "requires_python", "requires-python"]
            .filter((key) => targetRecord[key] !== undefined && targetRecord[key] !== "*")
            .map((key) => [key, targetRecord[key]]),
        );
        const conditional =
          req.condition ||
          fields.optional ||
          fields.python ||
          fields.platform ||
          Object.keys(applicability).length > 0;
        const condition: DependencyCondition | undefined = conditional
          ? {
              language: `${kind}:binding`,
              expression: { request: json(req), target: json(applicability) },
            }
          : undefined;
        out.edges.push({
          from: ids[index]!,
          to: target,
          status: "resolved",
          relation: "depends-on",
          requested: req,
          ...(typeof fields.optional === "boolean" && { optional: fields.optional }),
          ...(exact ||
          req.specifier === "*" ||
          normalizedName(req.specifier?.split(";")[0]?.trim() ?? "") ===
            normalizedName(req.name ?? "")
            ? condition
              ? { selection: "conditional", condition }
              : { selection: "selected" }
            : { selection: "unknown", ...(condition && { condition }) }),
        });
      } else {
        out.edges.push({
          from: ids[index]!,
          status: "unresolved",
          relation: "depends-on",
          ...(req.condition
            ? { selection: "conditional", condition: req.condition }
            : { selection: "unknown" }),
          requested: req,
          attributes: { "python:candidateViews": candidates },
        });
      }
    }
  });
  return out.finish("unknown", { "python:lockMetadata": json(native.metadata ?? {}) });
}

async function manifestAlongside(
  file: string,
  context: FileExtractionContextV2,
): Promise<AnalyzerResultV2 | undefined> {
  const path = join(dirname(file), "pyproject.toml");
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return pyprojectResult(content, {
    ...context,
    relativeFile: join(dirname(context.relativeFile), "pyproject.toml"),
  });
}

function extractor(
  name: string,
  glob: string,
  convert: (content: string, context: FileExtractionContextV2) => AnalyzerResultV2,
  manifest = false,
) {
  return filesExtractorV2<PythonOptions>({
    name,
    version: 1,
    optionsSchema: optionSchema,
    markFiles: async function (codebase, options) {
      await scanAndMarkFiles(this, codebase, glob, options.ignore);
    },
    extractFile: async (file, _options, context) => {
      const result = convert(await readNormalizedTextFile(file), context);
      if (!manifest) return result;
      try {
        const declarations = await manifestAlongside(file, context);
        return declarations ? mergeResultsV2([result, declarations]) : result;
      } catch (error) {
        const definitionFile = join(dirname(context.relativeFile), "pyproject.toml");
        result.issues.push({
          code: `${name}.manifest_failed`,
          severity: "ERROR",
          file: definitionFile,
          message: `Unable to read current declarations: ${error instanceof Error ? error.message : String(error)}`,
        });
        result.graphs.push(
          createDependencyGraph({
            source: { extractor: "pyprojecttoml", files: [definitionFile] },
            interpretation: "unknown",
            rootCompleteness: "unknown",
            roots: [],
            nodes: [],
            edges: [],
          }),
        );
        return normalizeResultV2(result);
      }
    },
  });
}
export const requirementsTxtExtractorV2 = extractor(
  "requirementstxt",
  "**/requirements*.txt",
  requirementsResult,
);
export const pyprojectTomlExtractorV2 = extractor(
  "pyprojecttoml",
  "**/pyproject.toml",
  pyprojectResult,
);
export const pipfileLockExtractorV2 = extractor("pipfilelock", "**/Pipfile.lock", pipfileResult);
export const poetryLockExtractorV2 = extractor(
  "poetrylock",
  "**/poetry.lock",
  (content, context) => lockResult(content, context, "poetrylock"),
  true,
);
export const pdmLockExtractorV2 = extractor(
  "pdmlock",
  "**/pdm.lock",
  (content, context) => lockResult(content, context, "pdmlock"),
  true,
);
