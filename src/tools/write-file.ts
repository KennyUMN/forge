import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import { resolvePath } from "./path-utils.js";

interface WriteFileInput {
  path: string;
  content: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path, content } = (input ?? {}) as Partial<WriteFileInput>;
  if (typeof path !== "string") {
    return { output: `Invalid input: "path" must be a string.`, isError: true };
  }
  if (typeof content !== "string") {
    return { output: `Invalid input: "content" must be a string.`, isError: true };
  }
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
