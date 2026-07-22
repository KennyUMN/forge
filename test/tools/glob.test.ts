import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globTool } from "../../src/tools/glob.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-glob-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(dir, "src", "a.ts"), "", "utf8");
  await writeFile(join(dir, "src", "b.js"), "", "utf8");
  await writeFile(join(dir, "node_modules", "pkg", "index.ts"), "", "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("globTool", () => {
  it("matches files by extension recursively", async () => {
    const result = await globTool.execute({ pattern: "**/*.ts" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/a.ts");
    expect(result.output).not.toContain("b.js");
  });

  it("excludes node_modules by default", async () => {
    const result = await globTool.execute({ pattern: "**/*.ts" }, { cwd: dir });

    expect(result.output).not.toContain("node_modules");
  });

  it("reports when nothing matches without erroring", async () => {
    const result = await globTool.execute({ pattern: "**/*.nonexistent" }, { cwd: dir });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("No files matched");
  });

  it("returns an error result instead of throwing when pattern is missing", async () => {
    await expect(globTool.execute({}, { cwd: dir })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
  });

  it("returns an error result instead of throwing when pattern is the wrong type", async () => {
    await expect(globTool.execute({ pattern: 123 }, { cwd: dir })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
  });

  it("returns an error result instead of throwing when input is null or undefined", async () => {
    await expect(globTool.execute(null, { cwd: dir })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
    await expect(globTool.execute(undefined, { cwd: dir })).resolves.toEqual(
      expect.objectContaining({ isError: true }),
    );
  });

  it("returns an error result instead of throwing when path is the wrong type", async () => {
    await expect(
      globTool.execute({ pattern: "**/*.ts", path: 123 }, { cwd: dir }),
    ).resolves.toEqual(expect.objectContaining({ isError: true }));
  });
});
