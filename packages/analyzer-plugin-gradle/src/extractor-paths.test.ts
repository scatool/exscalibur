import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { runCommand, validateResultV2 } from "@scatool/analyzer-core";
import { extractor, type GradleConfiguration } from "./extractor-v2.ts";

vi.mock("@scatool/analyzer-core", async (original) => ({
  ...(await original<typeof import("@scatool/analyzer-core")>()),
  runCommand: vi.fn(),
}));

const nativeConfiguration = (project: string): GradleConfiguration => ({
  rootOrigin: { id: `project ${project}`, path: project },
  configurationName: "runtimeClasspath",
  scope: "runtime",
  allDependencies: [
    {
      id: "org.example:shared:1",
      origin: { id: `project ${project}`, path: project },
      isDirect: true,
      isProject: false,
      coordinates: { group: "org.example", module: "shared", version: "1" },
      repositoryUrl: "https://repo.maven.apache.org/maven2",
      dependencies: [],
    },
  ],
});

async function checkout(root: string, projects = [":", ":app", ":lib"]): Promise<string> {
  const directory = join(root, "apps/service");
  await mkdir(join(directory, "build/reports/dependency-graph-snapshots"), { recursive: true });
  await writeFile(join(directory, process.platform === "win32" ? "gradlew.bat" : "gradlew"), "");
  for (const project of projects) {
    const path = project === ":" ? directory : join(directory, project.slice(1));
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "build.gradle"), "plugins { id 'java' }\n");
  }
  await writeFile(
    join(directory, "build/reports/dependency-graph-snapshots/dependency-graph.json"),
    JSON.stringify(projects.map(nativeConfiguration)),
  );
  return directory;
}

test("Gradle graph identities survive checkout relocation with nested multimodule metadata", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "gradle-relocation-"));
  const roots = [join(temporary, "local/repo"), join(temporary, "ci/work/repo")];
  try {
    const directories = await Promise.all(roots.map((root) => checkout(root)));
    vi.mocked(runCommand).mockReset();
    vi.mocked(runCommand).mockImplementation(async (command, options) => {
      expect(directories).toContain(options?.cwd);
      if (command.some((argument) => argument.endsWith("project-info.gradle"))) {
        const directory = options!.cwd!;
        const metadata = Object.fromEntries(
          [":", ":app", ":lib"].map((project) => [
            project,
            {
              name: project === ":" ? "service" : project.slice(1),
              group: "org.example",
              version: "1",
              buildFile: join(
                directory,
                project === ":" ? "" : project.slice(1),
                "build.gradle",
              ).replaceAll("\\", "/"),
            },
          ]),
        );
        return {
          exitCode: 0,
          stderr: "",
          stdout: `===PROJECT_INFO_START===\n${JSON.stringify(metadata)}\n===PROJECT_INFO_END===`,
        };
      }
      return { exitCode: 0, stderr: "", stdout: "" };
    });
    const results = [];
    for (const root of roots) {
      const result = await extractor.extract(root, {}, { codebaseId: "example:relocated-service" });
      validateResultV2(result);
      expect(result.issues).toEqual([]);
      expect(result.graphs).toHaveLength(3);
      expect(result.subprojects.map((project) => project.definitionFile).sort()).toEqual([
        "apps/service/app/build.gradle",
        "apps/service/build.gradle",
        "apps/service/lib/build.gradle",
      ]);
      for (const graph of result.graphs) {
        expect(graph.source.files).toEqual(["apps/service/build.gradle"]);
        expect(graph.roots[0]!.project.definitionFile).toMatch(
          /^apps\/service\/(?:app\/|lib\/)?build\.gradle$/,
        );
        expect(graph.nodes.find((node) => node.project)?.project).toEqual(graph.roots[0]!.project);
      }
      expect(JSON.stringify(result)).not.toContain(root.replaceAll("\\", "/"));
      results.push(result);
    }
    expect(runCommand).toHaveBeenCalledTimes(4);
    // Comparing all fields catches IDs hashed from absolute metadata even when
    // filesExtractor subsequently rebases the visible project paths correctly.
    expect(results[1]).toEqual(results[0]);
    expect(results[1]!.graphs.map((graph) => graph.id)).toEqual(
      results[0]!.graphs.map((graph) => graph.id),
    );
  } finally {
    vi.mocked(runCommand).mockReset();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Gradle metadata outside a sibling-prefix checkout retains its external identity", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "gradle-external-path-"));
  const root = join(temporary, "repo");
  const external = join(temporary, "repo-other/build.gradle").replaceAll("\\", "/");
  try {
    await checkout(root, [":"]);
    vi.mocked(runCommand).mockReset();
    vi.mocked(runCommand).mockImplementation(async (command) => ({
      exitCode: 0,
      stderr: "",
      stdout: command.some((argument) => argument.endsWith("project-info.gradle"))
        ? `===PROJECT_INFO_START===\n${JSON.stringify({ ":": { name: "external", group: "org.example", version: "1", buildFile: external } })}\n===PROJECT_INFO_END===`
        : "",
    }));
    const result = await extractor.extract(root, {}, { codebaseId: "example:external-project" });
    validateResultV2(result);
    expect(result.issues).toEqual([]);
    expect(result.subprojects[0]!.definitionFile).toBe(external);
    expect(result.graphs[0]!.roots[0]!.project.definitionFile).toBe(external);
    expect(result.graphs[0]!.nodes.find((node) => node.project)!.project!.definitionFile).toBe(
      external,
    );
  } finally {
    vi.mocked(runCommand).mockReset();
    await rm(temporary, { recursive: true, force: true });
  }
});
