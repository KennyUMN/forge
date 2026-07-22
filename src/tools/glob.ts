import { glob } from "glob";
import { join, relative } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import { resolvePath } from "./path-utils.js";
import { DEFAULT_IGNORE } from "./shared.js";

const MAX_RESULTS = 200;

interface GlobInput {
  pattern: string;
  path?: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { pattern, path } = (input ?? {}) as Partial<GlobInput>;
  if (typeof pattern !== "string") {
    return { output: `Invalid input: "pattern" must be a string.`, isError: true };
  }
  if (path !== undefined && typeof path !== "string") {
    return { output: `Invalid input: "path" must be a string.`, isError: true };
  }
  const root = resolvePath(path, context.cwd);

  let matches: string[];
  try {
    matches = await glob(pattern, { cwd: root, ignore: DEFAULT_IGNORE, nodir: true, dot: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Invalid pattern: ${message}`, isError: true };
  }
  matches.sort();

  if (matches.length === 0) {
    return { output: "No files matched.", isError: false };
  }

  const truncated = matches.length > MAX_RESULTS;
  const shown = truncated ? matches.slice(0, MAX_RESULTS) : matches;
  const lines = shown.map((match) => relative(context.cwd, join(root, match)));
  const suffix = truncated ? `\n... ${matches.length - MAX_RESULTS} more match(es) not shown; narrow the pattern.` : "";

  return { output: lines.join("\n") + suffix, isError: false };
}

export const globTool: Tool = {
  name: "glob",
  description: 'Finds files matching a glob pattern (e.g. "**/*.ts"), returning up to 200 paths relative to the working directory.',
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: 'Glob pattern to match, e.g. "src/**/*.ts".' },
      path: { type: "string", description: "Directory to search under; defaults to the working directory." },
    },
    required: ["pattern"],
  },
  execute,
};
