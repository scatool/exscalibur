/** Node's ancestor lookup, including intermediate workspace directories and scoped packages. */
export function npmResolutionCandidates(callerPath: string, name: string): string[] {
  const candidates: string[] = [];
  let directory = callerPath;
  while (true) {
    if (directory.slice(directory.lastIndexOf("/") + 1) !== "node_modules") {
      candidates.push(`${directory ? `${directory}/` : ""}node_modules/${name}`);
    }
    if (directory === "") break;
    const separator = directory.lastIndexOf("/");
    directory = separator === -1 ? "" : directory.slice(0, separator);
  }
  return candidates;
}
