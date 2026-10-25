import { PackageURL } from "packageurl-js";

export const NPM_DEPENDENCY_SCOPES = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export function createNpmPurl(name: string, version: string): string {
  let namespace: string | null = null;
  let packageName = name;

  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length === 2 && parts[0] && parts[1]) {
      namespace = parts[0];
      packageName = parts[1];
    }
  }

  return new PackageURL("npm", namespace, packageName, version, null, null).toString();
}
