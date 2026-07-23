import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves the package root from this module's own location rather than from
// process.cwd(): forge is a global command, so the directory it is invoked
// from is almost never the directory it is installed in. Both the compiled
// (dist/cli/install.js) and the source (src/cli/install.ts) copies sit two
// levels below the package root, so one expression serves the built CLI and
// the test suite alike.
export function installRoot(moduleUrl: string = import.meta.url): string {
  return dirname(dirname(dirname(fileURLToPath(moduleUrl))));
}

export async function readVersion(root: string = installRoot()): Promise<string> {
  try {
    const raw = await readFile(join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
