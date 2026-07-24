import { readFile, stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { forgeHome } from "../cli/paths.js";

export interface SteeringFile {
  path: string;
  content: string;
  scope: "global" | "ancestor" | "project";
}

const STEERING_FILENAMES = ["FORGE.md", "AGENTS.md"] as const;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

async function tryRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function findGitRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  const { root: fsRoot } = parse(dir);
  while (true) {
    if (await fileExists(join(dir, ".git"))) return dir;
    if (dir === fsRoot) return null;
    dir = dirname(dir);
  }
}

function ancestorDirs(cwd: string, gitRoot: string | null): string[] {
  const resolved = resolve(cwd);
  const { root: fsRoot } = parse(resolved);
  const stopAt = gitRoot ?? fsRoot;

  const dirs: string[] = [];
  let dir = dirname(resolved);
  while (true) {
    dirs.push(dir);
    if (dir === stopAt || dir === fsRoot) break;
    dir = dirname(dir);
  }
  return dirs.reverse();
}

async function loadFromDir(dir: string, scope: SteeringFile["scope"]): Promise<SteeringFile[]> {
  const results: SteeringFile[] = [];
  for (const name of STEERING_FILENAMES) {
    const filePath = resolve(join(dir, name));
    const content = await tryRead(filePath);
    if (content !== null) {
      results.push({ path: filePath, content, scope });
    }
  }
  return results;
}

export async function loadSteeringFiles(cwd: string): Promise<SteeringFile[]> {
  const seen = new Set<string>();
  const files: SteeringFile[] = [];

  const push = (entries: SteeringFile[]): void => {
    for (const entry of entries) {
      if (!seen.has(entry.path)) {
        seen.add(entry.path);
        files.push(entry);
      }
    }
  };

  push(await loadFromDir(forgeHome(), "global"));

  const resolvedCwd = resolve(cwd);
  const gitRoot = await findGitRoot(resolvedCwd);

  for (const dir of ancestorDirs(resolvedCwd, gitRoot)) {
    push(await loadFromDir(dir, "ancestor"));
  }

  push(await loadFromDir(resolvedCwd, "project"));

  return files;
}

export function formatSteeringContext(files: readonly SteeringFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map(
    (f) => `<steering-file path="${f.path}" scope="${f.scope}">\n${f.content}\n</steering-file>`,
  );

  return `\n\n# Steering Context\n\n${sections.join("\n\n")}`;
}
