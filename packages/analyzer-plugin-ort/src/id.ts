import { PackageURL } from "packageurl-js";

/**
 * Convert ORT ID string to Package URL (PURL)
 * ORT IDs have the format: "TYPE:NAMESPACE:NAME:VERSION" or "TYPE::NAME:VERSION"
 * Examples: "NPM::lodash:4.17.21", "Maven:org.example:my-lib:1.0.0"
 */
export function convertOrtIdToPurl(id: string): string {
  const parts = id.split(":");

  if (parts.length < 3) {
    // Fallback: return as-is if format is unexpected
    return id;
  }

  const type = parts[0] || "";

  // Check if there's a non-empty namespace (parts[1])
  // If parts[1] is empty, we have TYPE::NAME:VERSION format
  // If parts[1] is non-empty, we have TYPE:NAMESPACE:NAME:VERSION format
  const hasNamespace = parts[1] !== "";

  const namespace = hasNamespace ? parts[1] : null;
  const name = parts[2] || "";
  const version = parts.slice(3).join(":");

  // Map ORT identifier types to PURL types.
  // Keys cover both ORT *project* types (the manager name, e.g. "Cargo", "Bundler")
  // and *package* types (e.g. "Crate", "Gem"), since ORT emits both.
  // See ORT's getPurlType() in model/src/main/kotlin/utils/PurlExtensions.kt.
  const typeMap: Record<string, string> = {
    Bazel: "bazel",
    Bower: "bower",
    Bundler: "gem",
    Cargo: "cargo",
    Carthage: "carthage",
    CocoaPods: "cocoapods",
    Composer: "composer",
    Conan: "conan",
    Crate: "cargo",
    Gem: "gem",
    Gleam: "otp",
    Go: "golang",
    GoMod: "golang",
    Gradle: "maven",
    Hackage: "hackage",
    Hex: "hex",
    Maven: "maven",
    NPM: "npm",
    NuGet: "nuget",
    OTP: "otp",
    otp: "otp",
    PIP: "pypi",
    PNPM: "npm",
    Pipenv: "pypi",
    Pod: "cocoapods",
    Poetry: "pypi",
    Pub: "pub",
    PyPI: "pypi",
    SBT: "maven",
    Stack: "hackage",
    Swift: "swift",
    SwiftPM: "swift",
    Tycho: "maven",
    Yarn: "npm",
    Yarn2: "npm",
  };

  const purlType = typeMap[type] || type.toLowerCase();
  return new PackageURL(purlType, namespace, name || "", version || "", null, null).toString();
}
