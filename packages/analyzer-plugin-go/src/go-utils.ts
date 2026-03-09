import { PackageURL } from 'packageurl-js';

export function createGoPurl(modulePath: string, version?: string): string {
  return new PackageURL('golang', null, modulePath, version ?? null, null, null).toString();
}
