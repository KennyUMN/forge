import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";

export interface FileSymbols {
  file: string;
  symbols: Array<{ name: string; kind: "function" | "class" | "interface" | "type" | "const" | "method" }>;
}

const IGNORE_DIRS = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.forge/**"];
const MAX_FILES = 200;

const EXPORT_PATTERNS: Array<{ regex: RegExp; kind: FileSymbols["symbols"][number]["kind"] }> = [
  { regex: /^export\s+(?:async\s+)?function\s+(\w+)/, kind: "function" },
  { regex: /^export\s+class\s+(\w+)/, kind: "class" },
  { regex: /^export\s+interface\s+(\w+)/, kind: "interface" },
  { regex: /^export\s+type\s+(\w+)/, kind: "type" },
  { regex: /^export\s+const\s+(\w+)/, kind: "const" },
];

const METHOD_PATTERN = /^\s{2}(?:async\s+)?(\w+)\s*\(/;

export function extractSymbols(filePath: string, content: string): FileSymbols {
  const symbols: FileSymbols["symbols"] = [];
  const lines = content.split("\n");
  let insideClass = false;
  let braceDepth = 0;

  for (const line of lines) {
    for (const { regex, kind } of EXPORT_PATTERNS) {
      const match = regex.exec(line);
      if (match) {
        symbols.push({ name: match[1], kind });
        if (kind === "class") {
          insideClass = true;
          braceDepth = 0;
        }
        break;
      }
    }

    if (insideClass) {
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0 && line.includes("}")) {
        insideClass = false;
      } else {
        const methodMatch = METHOD_PATTERN.exec(line);
        if (methodMatch && !line.includes("private") && !line.trimStart().startsWith("//")) {
          symbols.push({ name: methodMatch[1], kind: "method" });
        }
      }
    }
  }

  return { file: filePath, symbols };
}

export async function buildRepoMap(
  rootDir: string,
  options: { depth?: number; filter?: string },
): Promise<FileSymbols[]> {
  const depth = options.depth ?? 3;
  const filter = options.filter ?? "**/*.ts";

  const files = await glob(filter, {
    cwd: rootDir,
    ignore: IGNORE_DIRS,
    nodir: true,
    dot: false,
    maxDepth: depth + 1,
  });

  const capped = files.slice(0, MAX_FILES);

  const results: FileSymbols[] = [];
  for (const relPath of capped) {
    let content: string;
    try {
      content = await readFile(join(rootDir, relPath), "utf8");
    } catch {
      continue;
    }
    const normalized = relPath.replace(/\\/g, "/");
    const fileSymbols = extractSymbols(normalized, content);
    if (fileSymbols.symbols.length > 0) {
      results.push(fileSymbols);
    }
  }

  return results;
}

export function formatRepoMap(symbols: FileSymbols[]): string {
  const lines: string[] = [];
  for (const entry of symbols) {
    if (entry.symbols.length === 0) continue;
    lines.push(entry.file);
    for (const sym of entry.symbols) {
      lines.push(`  ${sym.name} (${sym.kind})`);
    }
  }
  return lines.join("\n");
}
