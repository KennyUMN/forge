import { readFile } from "node:fs/promises";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import { resolvePath } from "./path-utils.js";

interface ReadFileInput {
  path: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path } = (input ?? {}) as Partial<ReadFileInput>;
  if (typeof path !== "string") {
    return { output: `Invalid input: "path" must be a string.`, isError: true };
  }
  const resolved = resolvePath(path, context.cwd);
  try {
    const content = await readFile(resolved, "utf8");
    return { output: content, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not read "${path}": ${message}`, isError: true };
  }
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Reads the full text contents of a file at the given path.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
    },
    required: ["path"],
  },
  execute,
};
