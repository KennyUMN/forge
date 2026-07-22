import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface ReadFileInput {
  path: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path } = input as ReadFileInput;
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
