import { describe, it, expect } from "vitest";
import type { LspClient, LspLocation, SymbolInfo, Diagnostic } from "../../src/lsp/lsp-client.js";

function createMockLspClient(overrides: Partial<LspClient> = {}): LspClient {
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

describe("LspClient interface contract", () => {
  it("initialize resolves without error", async () => {
    const client = createMockLspClient();
    await expect(client.initialize("/project")).resolves.toBeUndefined();
  });

  it("openDocument and closeDocument resolve without error", async () => {
    const client = createMockLspClient();
    await expect(client.openDocument("/project/a.ts", "const x = 1;")).resolves.toBeUndefined();
    await expect(client.closeDocument("/project/a.ts")).resolves.toBeUndefined();
  });

  it("definition returns Location[]", async () => {
    const loc: LspLocation = {
      uri: "file:///project/a.ts",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
    };
    const client = createMockLspClient({ definition: async () => [loc] });
    const result = await client.definition("/project/a.ts", 0, 6);
    expect(result).toEqual([loc]);
  });

  it("references returns Location[]", async () => {
    const locs: LspLocation[] = [
      { uri: "file:///project/a.ts", range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } } },
      { uri: "file:///project/b.ts", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } } },
    ];
    const client = createMockLspClient({ references: async () => locs });
    const result = await client.references("/project/a.ts", 0, 6);
    expect(result).toHaveLength(2);
    expect(result[1].uri).toContain("b.ts");
  });

  it("hover returns string or null", async () => {
    const withHover = createMockLspClient({ hover: async () => "const x: number" });
    expect(await withHover.hover("/project/a.ts", 0, 6)).toBe("const x: number");

    const withoutHover = createMockLspClient();
    expect(await withoutHover.hover("/project/a.ts", 0, 6)).toBeNull();
  });

  it("documentSymbols returns SymbolInfo[]", async () => {
    const symbols: SymbolInfo[] = [
      { name: "myFn", kind: "Function", range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } } },
      { name: "MyClass", kind: "Class", range: { start: { line: 4, character: 0 }, end: { line: 10, character: 1 } } },
    ];
    const client = createMockLspClient({ documentSymbols: async () => symbols });
    const result = await client.documentSymbols("/project/a.ts");
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("Function");
    expect(result[1].name).toBe("MyClass");
  });

  it("diagnostics returns Diagnostic[]", async () => {
    const diags: Diagnostic[] = [
      { severity: "error", message: "Cannot find name 'foo'", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
    ];
    const client = createMockLspClient({ diagnostics: async () => diags });
    const result = await client.diagnostics("/project/a.ts");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
  });

  it("shutdown resolves without error", async () => {
    const client = createMockLspClient();
    await expect(client.shutdown()).resolves.toBeUndefined();
  });
});
