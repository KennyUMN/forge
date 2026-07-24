import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import type { LspLocation } from "../lsp/lsp-client.js";

// Convert a file:// URI to a plain path without node:url's fileURLToPath, which
// resolves against the host OS: on Windows a driveless URI like
// file:///project/index.ts throws (no drive letter) and paths come back with
// backslashes. LSP servers speak forward-slash URIs on every platform, so we
// keep forward slashes and only strip a Windows drive letter's leading slash.
function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let path = decodeURIComponent(uri.slice("file://".length));
  // file:///C:/foo -> /C:/foo -> C:/foo ; file:///project/x -> /project/x (kept)
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

function formatLocation(loc: LspLocation): string {
  return `${uriToPath(loc.uri)}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`;
}

function formatLocations(locations: LspLocation[]): string {
  if (locations.length === 0) return "No results found.";
  return locations.map(formatLocation).join("\n");
}

interface PositionInput {
  file: string;
  line: number;
  character: number;
}

interface FileInput {
  file: string;
}

async function definitionExecute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!context.lsp) return { output: "LSP not configured. Install typescript-language-server and restart Forge to enable semantic code intelligence.", isError: true };
  const { file, line, character } = (input ?? {}) as Partial<PositionInput>;
  if (typeof file !== "string" || typeof line !== "number" || typeof character !== "number") {
    return { output: `Invalid input: "file" (string), "line" (number), and "character" (number) are required.`, isError: true };
  }
  try {
    const locations = await context.lsp.definition(file, line, character);
    return { output: formatLocations(locations), isError: false };
  } catch (err) {
    return { output: `LSP definition lookup failed: ${(err as Error).message}`, isError: true };
  }
}

async function referencesExecute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!context.lsp) return { output: "LSP not configured. Install typescript-language-server and restart Forge to enable semantic code intelligence.", isError: true };
  const { file, line, character } = (input ?? {}) as Partial<PositionInput>;
  if (typeof file !== "string" || typeof line !== "number" || typeof character !== "number") {
    return { output: `Invalid input: "file" (string), "line" (number), and "character" (number) are required.`, isError: true };
  }
  try {
    const locations = await context.lsp.references(file, line, character);
    return { output: formatLocations(locations), isError: false };
  } catch (err) {
    return { output: `LSP references lookup failed: ${(err as Error).message}`, isError: true };
  }
}

async function hoverExecute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!context.lsp) return { output: "LSP not configured. Install typescript-language-server and restart Forge to enable semantic code intelligence.", isError: true };
  const { file, line, character } = (input ?? {}) as Partial<PositionInput>;
  if (typeof file !== "string" || typeof line !== "number" || typeof character !== "number") {
    return { output: `Invalid input: "file" (string), "line" (number), and "character" (number) are required.`, isError: true };
  }
  try {
    const info = await context.lsp.hover(file, line, character);
    if (info === null) return { output: "No hover information available at this position.", isError: false };
    return { output: info, isError: false };
  } catch (err) {
    return { output: `LSP hover lookup failed: ${(err as Error).message}`, isError: true };
  }
}

async function symbolsExecute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!context.lsp) return { output: "LSP not configured. Install typescript-language-server and restart Forge to enable semantic code intelligence.", isError: true };
  const { file } = (input ?? {}) as Partial<FileInput>;
  if (typeof file !== "string") {
    return { output: `Invalid input: "file" (string) is required.`, isError: true };
  }
  try {
    const symbols = await context.lsp.documentSymbols(file);
    if (symbols.length === 0) return { output: "No symbols found.", isError: false };
    const lines = symbols.map((s) => `${s.kind} ${s.name} (${s.range.start.line + 1}:${s.range.start.character + 1})`);
    return { output: lines.join("\n"), isError: false };
  } catch (err) {
    return { output: `LSP document symbols lookup failed: ${(err as Error).message}`, isError: true };
  }
}

export const definitionTool: Tool = {
  name: "lsp_definition",
  description: "Go to the definition of a symbol at a given position using the language server. Returns file:line:character locations.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "Absolute path to the source file." },
      line: { type: "number", description: "Zero-based line number of the symbol." },
      character: { type: "number", description: "Zero-based character offset of the symbol." },
    },
    required: ["file", "line", "character"],
  },
  execute: definitionExecute,
};

export const referencesTool: Tool = {
  name: "lsp_references",
  description: "Find all references to a symbol at a given position using the language server. Returns file:line:character locations.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "Absolute path to the source file." },
      line: { type: "number", description: "Zero-based line number of the symbol." },
      character: { type: "number", description: "Zero-based character offset of the symbol." },
    },
    required: ["file", "line", "character"],
  },
  execute: referencesExecute,
};

export const hoverTool: Tool = {
  name: "lsp_hover",
  description: "Get type information and documentation for a symbol at a given position using the language server.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "Absolute path to the source file." },
      line: { type: "number", description: "Zero-based line number of the symbol." },
      character: { type: "number", description: "Zero-based character offset of the symbol." },
    },
    required: ["file", "line", "character"],
  },
  execute: hoverExecute,
};

export const symbolsTool: Tool = {
  name: "lsp_symbols",
  description: "List all symbols (functions, classes, variables, etc.) in a file using the language server.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "Absolute path to the source file." },
    },
    required: ["file"],
  },
  execute: symbolsExecute,
};
