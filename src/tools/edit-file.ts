import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface EditFileInput {
  path: string;
  oldText: string;
  newText: string;
}

function resolvePath(inputPath: string, cwd: string): string {
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { path, oldText, newText } = input as EditFileInput;
  const resolved = resolvePath(path, context.cwd);

  let content: string;
  try {
    content = await readFile(resolved, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not read "${path}": ${message}`, isError: true };
  }

  const occurrences = countOccurrences(content, oldText);
  if (occurrences === 0) {
    return { output: `Could not edit "${path}": the given oldText was not found in the file.`, isError: true };
  }
  if (occurrences > 1) {
    return {
      output: `Could not edit "${path}": the given oldText appears ${occurrences} times; it must uniquely identify one location. Include more surrounding context.`,
      isError: true,
    };
  }

  const updated = content.replace(oldText, newText);
  try {
    await writeFile(resolved, updated, "utf8");
    return { output: `Edited "${path}".`, isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Could not write "${path}": ${message}`, isError: true };
  }
}

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Replaces one uniquely-occurring block of text in a file with new text. Fails if oldText is not found or appears more than once.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, absolute or relative to the working directory." },
      oldText: { type: "string", description: "The exact text to find. Must appear exactly once in the file." },
      newText: { type: "string", description: "The text to replace it with." },
    },
    required: ["path", "oldText", "newText"],
  },
  execute,
};
