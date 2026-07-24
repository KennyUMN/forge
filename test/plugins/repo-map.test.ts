import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSymbols, buildRepoMap, formatRepoMap } from "../../src/plugins/repo-map/symbol-extractor.js";
import { repoMapTool } from "../../src/plugins/repo-map/repo-map-tool.js";
import { getTools } from "../../src/plugins/repo-map/index.js";

describe("extractSymbols", () => {
  it("extracts exported functions", () => {
    const content = `export function foo() {}\nexport async function bar() {}\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.file).toBe("test.ts");
    expect(result.symbols).toContainEqual({ name: "foo", kind: "function" });
    expect(result.symbols).toContainEqual({ name: "bar", kind: "function" });
  });

  it("extracts exported classes", () => {
    const content = `export class MyClass {\n  doThing() {}\n}\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.symbols).toContainEqual({ name: "MyClass", kind: "class" });
  });

  it("extracts exported interfaces", () => {
    const content = `export interface Foo {\n  bar: string;\n}\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.symbols).toContainEqual({ name: "Foo", kind: "interface" });
  });

  it("extracts exported types", () => {
    const content = `export type Result = string | number;\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.symbols).toContainEqual({ name: "Result", kind: "type" });
  });

  it("extracts exported consts", () => {
    const content = `export const MAX_SIZE = 100;\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.symbols).toContainEqual({ name: "MAX_SIZE", kind: "const" });
  });

  it("extracts class methods", () => {
    const content = `export class Service {\n  start() {}\n  async stop() {}\n  private hidden() {}\n}\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.symbols).toContainEqual({ name: "start", kind: "method" });
    expect(result.symbols).toContainEqual({ name: "stop", kind: "method" });
  });

  it("detects all symbol kinds in a single file", () => {
    const content = [
      `export function helper() {}`,
      `export class Widget {}`,
      `export interface Config {}`,
      `export type ID = string;`,
      `export const VERSION = "1.0";`,
    ].join("\n");
    const result = extractSymbols("all.ts", content);

    const kinds = result.symbols.map((s) => s.kind);
    expect(kinds).toContain("function");
    expect(kinds).toContain("class");
    expect(kinds).toContain("interface");
    expect(kinds).toContain("type");
    expect(kinds).toContain("const");
  });

  it("ignores non-exported declarations", () => {
    const content = `function internal() {}\nclass Private {}\nconst secret = 1;\n`;
    const result = extractSymbols("test.ts", content);

    expect(result.symbols).toHaveLength(0);
  });
});

describe("formatRepoMap", () => {
  it("formats symbols in the expected output format", () => {
    const symbols = [
      {
        file: "src/agent/turn-orchestrator.ts",
        symbols: [
          { name: "runTurn", kind: "function" as const },
          { name: "TurnOrchestratorOptions", kind: "interface" as const },
        ],
      },
      {
        file: "src/tool/tool.ts",
        symbols: [{ name: "Tool", kind: "interface" as const }],
      },
    ];

    const output = formatRepoMap(symbols);

    expect(output).toContain("src/agent/turn-orchestrator.ts");
    expect(output).toContain("  runTurn (function)");
    expect(output).toContain("  TurnOrchestratorOptions (interface)");
    expect(output).toContain("src/tool/tool.ts");
    expect(output).toContain("  Tool (interface)");
  });

  it("returns empty string for empty input", () => {
    expect(formatRepoMap([])).toBe("");
  });

  it("skips files with no symbols", () => {
    const symbols = [{ file: "empty.ts", symbols: [] }];
    expect(formatRepoMap(symbols)).toBe("");
  });
});

describe("buildRepoMap", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-repomap-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("walks directories and extracts symbols from matching files", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "main.ts"), `export function main() {}\n`, "utf8");

    const result = await buildRepoMap(dir, {});

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/main.ts");
    expect(result[0].symbols).toContainEqual({ name: "main", kind: "function" });
  });

  it("respects depth limiting", async () => {
    await mkdir(join(dir, "a", "b", "c"), { recursive: true });
    await writeFile(join(dir, "a", "top.ts"), `export function top() {}\n`, "utf8");
    await writeFile(join(dir, "a", "b", "mid.ts"), `export function mid() {}\n`, "utf8");
    await writeFile(join(dir, "a", "b", "c", "deep.ts"), `export function deep() {}\n`, "utf8");

    const result = await buildRepoMap(dir, { depth: 2 });

    const files = result.map((r) => r.file);
    expect(files).toContain("a/top.ts");
    expect(files).toContain("a/b/mid.ts");
    expect(files).not.toContain("a/b/c/deep.ts");
  });

  it("skips node_modules, .git, dist, and .forge directories", async () => {
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await mkdir(join(dir, ".git"), { recursive: true });
    await mkdir(join(dir, "dist"), { recursive: true });
    await mkdir(join(dir, ".forge"), { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "node_modules", "dep.ts"), `export function dep() {}\n`, "utf8");
    await writeFile(join(dir, ".git", "hook.ts"), `export function hook() {}\n`, "utf8");
    await writeFile(join(dir, "dist", "out.ts"), `export function out() {}\n`, "utf8");
    await writeFile(join(dir, ".forge", "cfg.ts"), `export function cfg() {}\n`, "utf8");
    await writeFile(join(dir, "src", "app.ts"), `export function app() {}\n`, "utf8");

    const result = await buildRepoMap(dir, {});

    const files = result.map((r) => r.file);
    expect(files).toEqual(["src/app.ts"]);
  });

  it("caps at 200 files", async () => {
    await Promise.all(
      Array.from({ length: 210 }, (_, i) =>
        writeFile(join(dir, `file${i}.ts`), `export function f${i}() {}\n`, "utf8"),
      ),
    );

    const result = await buildRepoMap(dir, {});

    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("filters files by glob pattern", async () => {
    await writeFile(join(dir, "code.ts"), `export function ts() {}\n`, "utf8");
    await writeFile(join(dir, "code.js"), `export function js() {}\n`, "utf8");

    const result = await buildRepoMap(dir, { filter: "**/*.ts" });

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("code.ts");
  });
});

describe("repo-map plugin", () => {
  it("getTools() returns the repo_map tool", () => {
    const tools = getTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("repo_map");
  });

  it("tool execution returns a formatted map", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-repomap-tool-"));
    try {
      await writeFile(join(dir, "index.ts"), `export function main() {}\nexport type Config = {};\n`, "utf8");

      const result = await repoMapTool.execute({ path: dir }, { cwd: dir });

      expect(result.isError).toBe(false);
      expect(result.output).toContain("index.ts");
      expect(result.output).toContain("  main (function)");
      expect(result.output).toContain("  Config (type)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns error for invalid path type", async () => {
    const result = await repoMapTool.execute({ path: 123 }, { cwd: "/tmp" });

    expect(result.isError).toBe(true);
  });
});
