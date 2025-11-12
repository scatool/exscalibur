import { PackageURL } from 'packageurl-js';

/**
 * Convert ORT ID string to Package URL (PURL)
 * ORT IDs have the format: "TYPE:NAMESPACE:NAME:VERSION" or "TYPE::NAME:VERSION"
 * Examples: "NPM::lodash:4.17.21", "Maven:org.example:my-lib:1.0.0"
 */
export function convertOrtIdToPurl(id: string): string {
  const parts = id.split(':');

  if (parts.length < 3) {
    // Fallback: return as-is if format is unexpected
    return id;
  }

  const type = parts[0] || '';

  // Check if there's a non-empty namespace (parts[1])
  // If parts[1] is empty, we have TYPE::NAME:VERSION format
  // If parts[1] is non-empty, we have TYPE:NAMESPACE:NAME:VERSION format
  const hasNamespace = parts[1] !== '';

  const namespace = hasNamespace ? parts[1] : null;
  const name = parts[2] || '';
  const version = parts.slice(3).join(':');

  // Map ORT package types to PURL types
  const typeMap: Record<string, string> = {
    NPM: 'npm',
    Maven: 'maven',
    PyPI: 'pypi',
    Pub: 'pub',
    NuGet: 'nuget',
    Cargo: 'cargo',
    Go: 'golang',
    GoMod: 'golang',
    CocoaPods: 'cocoapods',
    Composer: 'composer',
    Gem: 'gem',
    Gradle: 'maven',
    GradleInspector: 'maven',
    SBT: 'maven',
  };

  const purlType = typeMap[type] || type.toLowerCase();
  return new PackageURL(purlType, namespace, name || '', version || '', null, null).toString();
}
