import { PackageURL } from "packageurl-js";

export function parseContainerImage(imageRef: string): string | null {
  // Container image format: [registry/]name[:tag|@digest]

  // Per PURL spec:
  // - namespace: registry/user/organization (optional)
  // - name: image name (required)
  // - version: tag or sha256 (optional, prefer sha256)
  // - qualifiers: repository_url for non-Docker Hub registries

  let registry: string;
  let namespace = "";
  let name: string;
  let version = "";

  // Split by @ for digest
  let digestPart = "";
  const atIndex = imageRef.indexOf("@");
  if (atIndex !== -1) {
    digestPart = imageRef.substring(atIndex + 1);
    imageRef = imageRef.substring(0, atIndex);
  }

  // Split by : for tag
  const colonIndex = imageRef.lastIndexOf(":");
  if (colonIndex !== -1) {
    version = imageRef.substring(colonIndex + 1);
    imageRef = imageRef.substring(0, colonIndex);
  }

  // If we had a digest, use that as version and URL-encode the colon
  if (digestPart) {
    // Per spec example: sha256%3A244fd47e07d10
    version = digestPart.replace(":", "%3A");
  }

  // Default version if not specified
  if (!version) {
    version = "latest";
  }

  // Parse registry and name
  const parts = imageRef.split("/");

  // Check if first part is a registry (contains . or : or is localhost)
  if (
    parts.length > 1 &&
    (parts[0]?.includes(".") || parts[0]?.includes(":") || parts[0] === "localhost")
  ) {
    registry = parts[0] || "";
    const remainingParts = parts.slice(1);

    // For custom registries, everything except the last part is namespace
    if (remainingParts.length > 1) {
      namespace = remainingParts.slice(0, -1).join("/");
      name = remainingParts[remainingParts.length - 1] || "";
    } else {
      name = remainingParts[0] || "";
    }
  } else {
    // No explicit registry, assume Docker Hub
    registry = "docker.io";

    // For Docker Hub:
    // - Official images (no /): namespace is empty, name is just the image
    // - User/org images (has /): namespace is user/org, name is image
    if (imageRef.includes("/")) {
      const slashIndex = imageRef.lastIndexOf("/");
      namespace = imageRef.substring(0, slashIndex);
      name = imageRef.substring(slashIndex + 1);
    } else {
      // Official image - no namespace
      namespace = "";
      name = imageRef;
    }
  }

  // Create PURL per spec
  let qualifiers: Record<string, string> | null = null;

  // For non-Docker Hub registries, use repository_url qualifier
  if (registry && registry !== "docker.io") {
    qualifiers = { repository_url: registry };
  }

  const purl = new PackageURL("docker", namespace || null, name, version, qualifiers, null);

  return purl.toString();
}
