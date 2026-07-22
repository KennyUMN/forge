import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface WriteFileInput {
  path: string;
  content: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path, content } = input as WriteFileInput;
  const resolved = resolvePath(path, context.cwd);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf8");
    return { output: `Wrote ${content.length} characters to "${path}".`, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not write "${path}": ${message}`, isError: true };
  }
}

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Creates or overwrites a file at the given path with the given content, creating parent directories as needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
      content: { type: "string", description: "The full content to write." },
    },
    required: ["path", "content"],
  },
  execute,
};
