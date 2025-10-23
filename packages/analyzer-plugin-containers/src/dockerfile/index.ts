import { type AnalyzerResult, type Extractor, filesExtractor } from '@scatool/analyzer-core/src/index.ts';
import { Glob } from 'bun';
import { PackageURL } from 'packageurl-js';

const argRegex = /^\s*ARG\s+([A-Z_][A-Z0-9_]*)=(.+?)(?:\s*#.*)?$/gim;
const stageRegex = /^\s*FROM\s+(?:--platform=\S+\s+)?\S+\s+AS\s+(\S+)(?:\s*#.*)?/gim;
const fromRegex = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s|#|$)/gim;

export const extractor: Extractor = filesExtractor({
  version: 1,
  markFiles: async function (codebase: string) {
    const dockerfiles = new Glob('**/Dockerfile*');
    for await (const file of dockerfiles.scan({
      cwd: codebase,
      absolute: true,
    })) {
      this.markFile(file);
    }
  },
  extractFile: async (file: string): Promise<AnalyzerResult> => {
    const content = await Bun.file(file).text();
    return extractDockerfile(content, file);
  },
});

export async function extractDockerfile(content: string, filePath?: string): Promise<AnalyzerResult> {
  const packages: Array<{ purl: string; lineNumber: number }> = [];

  // Parse ARG instructions to build a variable map
  const args = new Map<string, string>();
  let argMatch;
  while ((argMatch = argRegex.exec(content)) !== null) {
    const varName = argMatch[1];
    const varValue = argMatch[2];
    if (varName && varValue) {
      args.set(varName, varValue.trim());
    }
  }

  // Collect all stage names to exclude internal references
  const stageNames = new Set<string>();
  let stageMatch;
  while ((stageMatch = stageRegex.exec(content)) !== null) {
    const stageName = stageMatch[1];
    if (stageName) {
      stageNames.add(stageName.toLowerCase());
    }
  }

  // Match FROM instructions and track line numbers
  let match;
  while ((match = fromRegex.exec(content)) !== null) {
    let imageRef = match[1];

    // Skip on scratch image
    if (!imageRef || imageRef === 'scratch') continue;

    // Skip if this is a reference to an internal stage
    if (stageNames.has(imageRef.toLowerCase())) {
      continue;
    }

    // Substitute ARG variables
    imageRef = substituteArgs(imageRef, args);

    const purl = parseContainerImage(imageRef);
    if (purl) {
      // Calculate line number by counting newlines before the match
      const lineNumber = content.substring(0, match.index).split('\n').length;
      packages.push({ purl, lineNumber });
    }
  }

  return {
    packages: packages.map((pkg) => {
      const result: { purl: string; evidence?: string[] } = { purl: pkg.purl };
      if (filePath) {
        result.evidence = [`${filePath}#${pkg.lineNumber}`];
      }
      return result;
    }),
  };
}

// Replace ${VAR} and $VAR with values from args map
export function substituteArgs(str: string, args: Map<string, string>): string {
  let result = str;

  // Replace ${VAR} format
  result = result.replace(/\$\{([A-Z_][A-Z0-9_]*)}/g, (match, varName) => args.get(varName) || match);

  // Replace $VAR format (without braces)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => args.get(varName) || match);

  return result;
}

export function parseContainerImage(imageRef: string): string | null {
  // Container image format: [registry/]name[:tag|@digest]

  // Per PURL spec:
  // - namespace: registry/user/organization (optional)
  // - name: image name (required)
  // - version: tag or sha256 (optional, prefer sha256)
  // - qualifiers: repository_url for non-Docker Hub registries

  let registry = '';
  let namespace = '';
  let name = '';
  let version = '';

  // Split by @ for digest
  let digestPart = '';
  const atIndex = imageRef.indexOf('@');
  if (atIndex !== -1) {
    digestPart = imageRef.substring(atIndex + 1);
    imageRef = imageRef.substring(0, atIndex);
  }

  // Split by : for tag
  const colonIndex = imageRef.lastIndexOf(':');
  if (colonIndex !== -1) {
    version = imageRef.substring(colonIndex + 1);
    imageRef = imageRef.substring(0, colonIndex);
  }

  // If we had a digest, use that as version and URL-encode the colon
  if (digestPart) {
    // Per spec example: sha256%3A244fd47e07d10
    version = digestPart.replace(':', '%3A');
  }

  // Default version if not specified
  if (!version) {
    version = 'latest';
  }

  // Parse registry and name
  const parts = imageRef.split('/');

  // Check if first part is a registry (contains . or : or is localhost)
  if (parts.length > 1 && (parts[0]?.includes('.') || parts[0]?.includes(':') || parts[0] === 'localhost')) {
    registry = parts[0] || '';
    const remainingParts = parts.slice(1);

    // For custom registries, everything except the last part is namespace
    if (remainingParts.length > 1) {
      namespace = remainingParts.slice(0, -1).join('/');
      name = remainingParts[remainingParts.length - 1] || '';
    } else {
      name = remainingParts[0] || '';
    }
  } else {
    // No explicit registry, assume Docker Hub
    registry = 'docker.io';

    // For Docker Hub:
    // - Official images (no /): namespace is empty, name is just the image
    // - User/org images (has /): namespace is user/org, name is image
    if (imageRef.includes('/')) {
      const slashIndex = imageRef.lastIndexOf('/');
      namespace = imageRef.substring(0, slashIndex);
      name = imageRef.substring(slashIndex + 1);
    } else {
      // Official image - no namespace
      namespace = '';
      name = imageRef;
    }
  }

  // Create PURL per spec
  let qualifiers: Record<string, string> | null = null;

  // For non-Docker Hub registries, use repository_url qualifier
  if (registry && registry !== 'docker.io') {
    qualifiers = { repository_url: registry };
  }

  const purl = new PackageURL('docker', namespace || null, name, version, qualifiers, null);

  return purl.toString();
}
