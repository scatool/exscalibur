import { type AnalyzerResult, type Extractor, filesExtractor } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';
import { parseContainerImage } from '@scatool/analyzer-plugin-containers/src/dockerfile/index.ts';

export const extractor: Extractor = filesExtractor({
  name: 'github-actions',
  version: 1,
  markFiles: async function (codebase: string) {
    const glob = new Glob('.github/workflows/**/*.{yml,yaml}');
    for await (const file of glob.scan({
      cwd: codebase,
      dot: true,
      absolute: true,
    })) {
      this.markFile(file);
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    return extractWorkflow(content, file);
  },
});

export async function extractWorkflow(content: string, filePath?: string): Promise<AnalyzerResult> {
  const workflow = Bun.YAML.parse(content);
  const packages: Array<{ purl: string; lineNumber?: number }> = [];

  // Extract actions from jobs
  if (workflow && typeof workflow === 'object' && 'jobs' in workflow) {
    const jobs = workflow.jobs;
    if (jobs && typeof jobs === 'object') {
      for (const job of Object.values(jobs)) {
        if (job && typeof job === 'object' && 'steps' in job) {
          const steps = job.steps;
          if (Array.isArray(steps)) {
            for (const step of steps) {
              if (step && typeof step === 'object' && 'uses' in step) {
                const uses = step.uses;
                if (typeof uses === 'string') {
                  // Parse action reference (e.g., "actions/checkout@v4")
                  const actionPurl = parseActionReference(uses);
                  if (actionPurl) {
                    // Find line number by searching for "uses: <value>" in content
                    const lineNumber = findLineNumber(content, uses);
                    packages.push({ purl: actionPurl, lineNumber });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return {
    packages: packages.map((pkg) => {
      const result: { purl: string; evidence?: string[] } = { purl: pkg.purl };
      if (filePath && pkg.lineNumber) {
        result.evidence = [`${filePath}#${pkg.lineNumber}`];
      }
      return result;
    }),
  };
}

// Find the line number where a "uses:" statement appears
function findLineNumber(content: string, usesValue: string): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match "uses: <value>" or "uses: '<value>'" or 'uses: "<value>"'
    if (
      line &&
      (line.includes(`uses: ${usesValue}`) ||
        line.includes(`uses: '${usesValue}'`) ||
        line.includes(`uses: "${usesValue}"`))
    ) {
      return i + 1; // Line numbers are 1-indexed
    }
  }
  return undefined;
}

function parseActionReference(uses: string): string | null {
  // Check for docker:// scheme actions
  if (uses.startsWith('docker://')) {
    const imageRef = uses.substring('docker://'.length);
    return parseContainerImage(imageRef);
  }

  // GitHub Actions reference format: owner/repo@ref or owner/repo/path@ref
  // Split by @
  const atIndex = uses.lastIndexOf('@');
  if (atIndex === -1) {
    return null; // No version/ref specified
  }

  const actionPath = uses.substring(0, atIndex);
  const ref = uses.substring(atIndex + 1);

  // Parse owner/repo or owner/repo/path
  const parts = actionPath.split('/');
  if (parts.length < 2) {
    return null; // Invalid format
  }

  const namespace = parts[0];
  const name = parts.slice(1).join('/'); // Include path if present

  // Create PURL for GitHub action
  // Format: pkg:github/owner/repo@ref
  const purl = new PackageURL('github', namespace, name, ref, null, null);
  return purl.toString();
}
