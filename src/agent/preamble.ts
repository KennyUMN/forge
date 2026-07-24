import { execFile } from "node:child_process";

export interface PreambleOptions {
  cwd: string;
  toolNames: string[];
  maxSteps: number;
  signal?: AbortSignal;
}

const COMMAND_TIMEOUT_MS = 2000;

function run(cmd: string, args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout: COMMAND_TIMEOUT_MS, signal }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      resolve(stdout.trim());
    });
    child.on("error", () => resolve(""));
  });
}

async function getDirectoryTree(cwd: string, signal?: AbortSignal): Promise<string> {
  const output = await run(
    "find",
    [".", "-maxdepth", "2", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*", "-not", "-path", "*/dist/*"],
    cwd,
    signal,
  );
  if (!output) return "";
  const lines = output.split("\n").slice(0, 100);
  return lines.join("\n");
}

async function getGitInfo(cwd: string, signal?: AbortSignal): Promise<string> {
  const branch = await run("git", ["symbolic-ref", "--short", "HEAD"], cwd, signal);
  if (!branch) return "";

  const status = await run("git", ["status", "--short"], cwd, signal);
  const modifiedCount = status ? status.split("\n").filter((l) => l.length > 0).length : 0;

  if (modifiedCount > 0) {
    return `Git branch: ${branch} (${modifiedCount} modified file${modifiedCount === 1 ? "" : "s"})`;
  }
  return `Git branch: ${branch}`;
}

export async function buildEnvironmentPreamble(options: PreambleOptions): Promise<string> {
  const { cwd, toolNames, maxSteps, signal } = options;

  const [tree, gitInfo] = await Promise.all([
    getDirectoryTree(cwd, signal),
    getGitInfo(cwd, signal),
  ]);

  const sections: string[] = [];

  sections.push("## Environment");
  sections.push(`Working directory: ${cwd}`);
  if (gitInfo) {
    sections.push(gitInfo);
  }

  if (tree) {
    sections.push("");
    sections.push("## Project structure (depth 2)");
    sections.push(tree);
  }

  sections.push("");
  sections.push("## Available tools");
  sections.push(toolNames.join(", "));

  sections.push("");
  sections.push("## Constraints");
  sections.push(`Step budget: ${maxSteps}`);

  return sections.join("\n");
}
