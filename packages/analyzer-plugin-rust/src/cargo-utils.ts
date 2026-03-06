import { PackageURL } from 'packageurl-js';

export function createCargoPurl(name: string, version: string): string {
  return new PackageURL('cargo', null, name, version, null, null).toString();
}
