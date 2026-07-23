import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import { resolvePath, toPosixPath } from "./path-utils.js";
import { DEFAULT_IGNORE } from "./shared.js";

const DEFAULT_FILE_PATTERN = "**/*";
const MAX_MATCHES = 200;

interface GrepInput {
  pattern: string;
  path?: string;
  filePattern?: string;
}

interface Match {
  file: string;
  line: number;
  content: string;
}

async function searchFile(absolutePath: string, relativePath: string, regex: RegExp): Promise<Match[]> {
  let content: string;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch {
    return [];
  }
  const matches: Match[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matches.push({ file: relativePath, line: i + 1, content: lines[i] });
    }
  }
  return matches;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const { pattern, path, filePattern } = (input ?? {}) as Partial<GrepInput>;
  if (typeof pattern !== "string") {
    return { output: `Invalid input: "pattern" must be a string.`, isError: true };
  }
  if (path !== undefined && typeof path !== "string") {
    return { output: `Invalid input: "path" must be a string.`, isError: true };
  }
  const root = resolvePath(path, context.cwd);

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Invalid pattern: ${message}`, isError: true };
  }

  let files: string[];
  try {
    files = await glob(filePattern ?? DEFAULT_FILE_PATTERN, {
      cwd: root,
      ignore: DEFAULT_IGNORE,
      nodir: true,
      dot: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Invalid file pattern: ${message}`, isError: true };
  }

  const allMatches: Match[] = [];
  for (const file of files) {
    const absolutePath = join(root, file);
    const relativePath = toPosixPath(relative(context.cwd, absolutePath));
    allMatches.push(...(await searchFile(absolutePath, relativePath, regex)));
    // Only stop once strictly over the cap, so a file landing exactly on
    // MAX_MATCHES doesn't cause later matches to be dropped without notice
    // (see truncated check below, which depends on this invariant).
    if (allMatches.length > MAX_MATCHES) break;
  }

  if (allMatches.length === 0) {
    return { output: "No matches found.", isError: false };
  }

  const truncated = allMatches.length > MAX_MATCHES;
  const shown = truncated ? allMatches.slice(0, MAX_MATCHES) : allMatches;
  const lines = shown.map((m) => `${m.file}:${m.line}:${m.content}`);
  // Unlike glob's suffix, this can't report an exact hidden count: the loop above
  // breaks out of the file-by-file scan as soon as it goes over the cap, so any
  // matches in files after that point are never counted. Don't "fix" this into
  // reporting a number -- it would have to be an undercount of the true total.
  const suffix = truncated ? `\n... more matches not shown; narrow the pattern or path.` : "";

  return { output: lines.join("\n") + suffix, isError: false };
}

export const grepTool: Tool = {
  name: "grep",
  description: 'Searches file contents for a regular expression pattern, returning up to 200 matches as "path:line:content".',
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: { type: "string", description: "Directory to search under; defaults to the working directory." },
      filePattern: { type: "string", description: "Glob restricting which files to search; defaults to all files." },
    },
    required: ["pattern"],
  },
  execute,
};
