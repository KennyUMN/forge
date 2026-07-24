import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../../tool/tool.js";
import { resolvePath } from "../../tools/path-utils.js";
import { buildRepoMap, formatRepoMap } from "./symbol-extractor.js";

interface RepoMapInput {
  path?: string;
  depth?: number;
  filter?: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path, depth, filter } = (input ?? {}) as Partial<RepoMapInput>;

  if (path !== undefined && typeof path !== "string") {
    return { output: `Invalid input: "path" must be a string.`, isError: true };
  }
  if (depth !== undefined && typeof depth !== "number") {
    return { output: `Invalid input: "depth" must be a number.`, isError: true };
  }
  if (filter !== undefined && typeof filter !== "string") {
    return { output: `Invalid input: "filter" must be a string.`, isError: true };
  }

  const root = resolvePath(path, context.cwd);

  try {
    const symbols = await buildRepoMap(root, { depth, filter });
    const output = formatRepoMap(symbols);
    return { output: output || "No exported symbols found.", isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Failed to build repo map: ${message}`, isError: true };
  }
}

export const repoMapTool: Tool = {
  name: "repo_map",
  description:
    "Generate a structural map of the repository showing files and their exported symbols (functions, classes, interfaces, types). Use to understand project structure before making changes.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to map (default: cwd)" },
      depth: { type: "number", description: "Directory depth (default: 3)" },
      filter: { type: "string", description: "Glob pattern to filter files (default: **/*.ts)" },
    },
  },
  execute,
};
