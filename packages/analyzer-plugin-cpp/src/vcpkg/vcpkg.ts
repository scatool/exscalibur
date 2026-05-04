import {
  type AnalyzerResult,
  buildResult,
  errorResult,
  initializeExtractionMaps,
  type MarkFileContext,
  scanAndMarkFiles,
  type Subproject,
} from '@scatool/analyzer-core/src/index.ts';
import type { VcpkgOptions } from './options.ts';
import { dirname, resolve } from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { VcpkgDependInfo } from './types_dependencies.ts';
import { createVcpkgPurl, retrieveVcpkgReferenceLineNumber } from './utils.ts';
import type { VcpkgPackageInfoResult } from './types_packages.ts';

export async function markFiles(this: MarkFileContext, codebase: string, options: VcpkgOptions) {
  await scanAndMarkFiles(this, codebase, '**/vcpkg.json', options.ignore);
}

export async function extractFile(file: string, options: VcpkgOptions): Promise<AnalyzerResult> {
  // retrieve absolute path to ensure consistent behavior
  file = resolve(file);

  const vcpkgPath = options.vcpkgPath;

  const { packageMap, relationshipsMap } = initializeExtractionMaps();
  const subprojects: Subproject[] = [];

  try {
    const dependencies = await retrieveDependencies(file, vcpkgPath);

    const vcpkgContent = await Bun.file(file).text();

    // 1. create packages
    for (const node of dependencies.DirectedGraph.Nodes.Node) {
      const packageName = node.Id;
      const packageInfoResult = await retrievePackageInfo(packageName, file, vcpkgPath);
      const packageInfo = packageInfoResult.results[packageName];

      if (!packageInfo) {
        throw new Error(`Package info for "${packageName}" not found in vcpkg output`);
      }

      const version =
        packageInfo.version ??
        packageInfo['version-date'] ??
        packageInfo['version-semver'] ??
        packageInfo['version-string'];

      if (!version) {
        throw new Error(
          `Expected version information for each library in vcpkg. Was not found for "${packageName}"...`,
        );
      }

      const purl = createVcpkgPurl(packageName, version, false);

      // evidence is 1-indexed
      const evidence = new Set(retrieveVcpkgReferenceLineNumber(packageName, vcpkgContent).map((i) => String(i + 1)));

      packageMap.set(purl, {
        purl,
        evidence,
      });
    }

    // 2. create relationships

    return buildResult(packageMap, relationshipsMap, subprojects);
  } catch (e) {
    return errorResult(
      file,
      file,
      'Error during extracting vcpkg information:' + (e instanceof Error ? e.message : String(e)),
    );
  }
}

async function retrieveDependencies(file: string, vcpkgPath: string): Promise<VcpkgDependInfo> {
  const dir = dirname(file);

  const cmd = [vcpkgPath, 'depend-info', '--format=dgml'];
  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: dir,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`"${cmd.join(' ')}" failed with exit code ${exitCode}: ${proc.stderr}`);
  }

  // Parse the DGML XML output
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  });

  const dependInfo: VcpkgDependInfo = parser.parse(await proc.stdout.text());
  return dependInfo;
}

async function retrievePackageInfo(
  packageName: string,
  vcpkgFile: string,
  vcpkgPath: string,
): Promise<VcpkgPackageInfoResult> {
  const dir = dirname(vcpkgFile);

  const cmd = [vcpkgPath, 'x-package-info', packageName, '--x-json'];
  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: dir,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`"${cmd.join(' ')}" failed with exit code ${exitCode}: ${proc.stderr}`);
  }

  const parsed: VcpkgPackageInfoResult = await proc.stdout.json();
  return parsed;
}
