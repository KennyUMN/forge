import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { loadManifest } from "./manifest.js";
import type { ExtensionManifest } from "./manifest.js";
import { forgeHome } from "../cli/paths.js";

const execFileAsync = promisify(execFile);

export interface LoadedExtension {
  manifest: ExtensionManifest;
  dir: string;
  contextContent?: string;
}

async function scanExtensionDir(baseDir: string): Promise<LoadedExtension[]> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const loaded: LoadedExtension[] = [];
  for (const entry of entries) {
    const extDir = join(baseDir, entry);
    try {
      const manifest = await loadManifest(extDir);
      let contextContent: string | undefined;
      if (manifest.context) {
        const contextPath = resolve(extDir, manifest.context);
        try {
          contextContent = await readFile(contextPath, "utf8");
        } catch {
          // Context file missing is non-fatal; the extension still loads.
        }
      }
      loaded.push({ manifest, dir: extDir, contextContent });
    } catch {
      // Skip directories without a valid manifest.
    }
  }
  return loaded;
}

export async function discoverExtensions(
  cwd: string,
  globalHome?: string,
  additionalDirs?: string[],
): Promise<LoadedExtension[]> {
  const dirs: string[] = [];

  const home = globalHome ?? forgeHome();
  dirs.push(join(home, "extensions"));
  dirs.push(join(cwd, ".forge", "extensions"));

  if (additionalDirs) {
    dirs.push(...additionalDirs);
  }

  const results: LoadedExtension[] = [];
  for (const dir of dirs) {
    results.push(...(await scanExtensionDir(dir)));
  }
  return results;
}

export async function installExtension(gitUrl: string, targetDir: string): Promise<void> {
  await execFileAsync("git", ["clone", gitUrl, targetDir]);
}
