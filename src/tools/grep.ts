import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**"];
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

function resolveSearchRoot(inputPath: string | undefined, cwd: string): string {
  if (!inputPath) return cwd;
  return isAbsolute(inputPath) ? inputPath : join(cwd, inputPath);
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
  const { pattern, path, filePattern } = input as GrepInput;
  const root = resolveSearchRoot(path, context.cwd);

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Invalid pattern: ${message}`, isError: true };
  }

  const files = await glob(filePattern ?? DEFAULT_FILE_PATTERN, {
    cwd: root,
    ignore: DEFAULT_IGNORE,
    nodir: true,
    dot: false,
  });

  const allMatches: Match[] = [];
  for (const file of files) {
    const absolutePath = join(root, file);
    const relativePath = relative(context.cwd, absolutePath);
    allMatches.push(...(await searchFile(absolutePath, relativePath, regex)));
    if (allMatches.length >= MAX_MATCHES) break;
  }

  if (allMatches.length === 0) {
    return { output: "No matches found.", isError: false };
  }

  const truncated = allMatches.length > MAX_MATCHES;
  const shown = truncated ? allMatches.slice(0, MAX_MATCHES) : allMatches;
  const lines = shown.map((m) => `${m.file}:${m.line}:${m.content}`);
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
