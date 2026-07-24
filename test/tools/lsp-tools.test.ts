import { describe, it, expect } from "vitest";
import { definitionTool, referencesTool, hoverTool, symbolsTool } from "../../src/tools/lsp-tools.js";
import type { LspClient, LspLocation, SymbolInfo } from "../../src/lsp/lsp-client.js";
import type { ToolExecutionContext } from "../../src/tool/tool.js";

function createMockLsp(overrides: Partial<LspClient> = {}): LspClient {
  return {
    initialize: async () => {},
    openDocument: async () => {},
    closeDocument: async () => {},
    definition: async () => [],
    references: async () => [],
    hover: async () => null,
    documentSymbols: async () => [],
    diagnostics: async () => [],
    shutdown: async () => {},
    ...overrides,
  };
}

function contextWith(lsp?: LspClient): ToolExecutionContext {
  return { cwd: "/project", lsp };
}

describe("lsp_definition tool", () => {
  it("returns formatted file:line:character locations", async () => {
    const loc: LspLocation = {
      uri: "file:///project/src/index.ts",
      range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
    };
    const lsp = createMockLsp({ definition: async () => [loc] });
    const result = await definitionTool.execute({ file: "/project/src/index.ts", line: 0, character: 6 }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toBe("/project/src/index.ts:10:5");
  });

  it("returns 'No results found.' when definition returns empty", async () => {
    const lsp = createMockLsp({ definition: async () => [] });
    const result = await definitionTool.execute({ file: "/project/a.ts", line: 0, character: 0 }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toBe("No results found.");
  });

  it("returns helpful error when LSP not configured", async () => {
    const result = await definitionTool.execute({ file: "/project/a.ts", line: 0, character: 0 }, contextWith(undefined));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("LSP not configured");
  });

  it("returns error for invalid input", async () => {
    const lsp = createMockLsp();
    const result = await definitionTool.execute({ file: 123 }, contextWith(lsp));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid input");
  });
});

describe("lsp_references tool", () => {
  it("returns multiple formatted locations", async () => {
    const locs: LspLocation[] = [
      { uri: "file:///project/a.ts", range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } } },
      { uri: "file:///project/b.ts", range: { start: { line: 14, character: 2 }, end: { line: 14, character: 3 } } },
    ];
    const lsp = createMockLsp({ references: async () => locs });
    const result = await referencesTool.execute({ file: "/project/a.ts", line: 0, character: 6 }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toBe("/project/a.ts:1:7\n/project/b.ts:15:3");
  });

  it("returns helpful error when LSP not configured", async () => {
    const result = await referencesTool.execute({ file: "/project/a.ts", line: 0, character: 0 }, contextWith(undefined));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("LSP not configured");
  });
});

describe("lsp_hover tool", () => {
  it("returns type info string", async () => {
    const lsp = createMockLsp({ hover: async () => "const x: number" });
    const result = await hoverTool.execute({ file: "/project/a.ts", line: 0, character: 6 }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toBe("const x: number");
  });

  it("returns message when no hover info available", async () => {
    const lsp = createMockLsp({ hover: async () => null });
    const result = await hoverTool.execute({ file: "/project/a.ts", line: 0, character: 0 }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toContain("No hover information");
  });

  it("returns helpful error when LSP not configured", async () => {
    const result = await hoverTool.execute({ file: "/project/a.ts", line: 0, character: 0 }, contextWith(undefined));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("LSP not configured");
  });
});

describe("lsp_symbols tool", () => {
  it("returns formatted symbol list", async () => {
    const symbols: SymbolInfo[] = [
      { name: "main", kind: "Function", range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } } },
      { name: "Config", kind: "Interface", range: { start: { line: 7, character: 0 }, end: { line: 12, character: 1 } } },
    ];
    const lsp = createMockLsp({ documentSymbols: async () => symbols });
    const result = await symbolsTool.execute({ file: "/project/a.ts" }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toBe("Function main (1:1)\nInterface Config (8:1)");
  });

  it("returns 'No symbols found.' for empty result", async () => {
    const lsp = createMockLsp({ documentSymbols: async () => [] });
    const result = await symbolsTool.execute({ file: "/project/a.ts" }, contextWith(lsp));

    expect(result.isError).toBe(false);
    expect(result.output).toBe("No symbols found.");
  });

  it("returns helpful error when LSP not configured", async () => {
    const result = await symbolsTool.execute({ file: "/project/a.ts" }, contextWith(undefined));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("LSP not configured");
  });

  it("returns error for missing file parameter", async () => {
    const lsp = createMockLsp();
    const result = await symbolsTool.execute({}, contextWith(lsp));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid input");
  });
});

describe("tool schemas", () => {
  const tools = [definitionTool, referencesTool, hoverTool, symbolsTool];

  it("all tools have valid names", () => {
    expect(definitionTool.name).toBe("lsp_definition");
    expect(referencesTool.name).toBe("lsp_references");
    expect(hoverTool.name).toBe("lsp_hover");
    expect(symbolsTool.name).toBe("lsp_symbols");
  });

  it("all tools have descriptions", () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("all tools have valid JSON Schema parameters", () => {
    for (const tool of tools) {
      const params = tool.parameters as { type: string; properties: Record<string, unknown>; required: string[] };
      expect(params.type).toBe("object");
      expect(params.properties).toBeDefined();
      expect(Array.isArray(params.required)).toBe(true);
      for (const key of params.required) {
        expect(params.properties[key]).toBeDefined();
      }
    }
  });

  it("position tools require file, line, character", () => {
    for (const tool of [definitionTool, referencesTool, hoverTool]) {
      const params = tool.parameters as { required: string[] };
      expect(params.required).toEqual(["file", "line", "character"]);
    }
  });

  it("symbols tool requires only file", () => {
    const params = symbolsTool.parameters as { required: string[] };
    expect(params.required).toEqual(["file"]);
  });
});
