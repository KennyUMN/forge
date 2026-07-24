import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadManifest, validateManifest } from "../../src/extension/manifest.js";
import type { ExtensionManifest } from "../../src/extension/manifest.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-ext-manifest-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const manifest = { name: "my-ext", version: "1.0.0" };
    expect(validateManifest(manifest)).toBe(true);
  });

  it("accepts a fully populated manifest", () => {
    const manifest: ExtensionManifest = {
      name: "full-ext",
      version: "2.1.0",
      description: "A full extension",
      tools: ["./tools/my-tool.js"],
      mcpServers: { fs: { command: "npx", args: ["-y", "@anthropic/mcp-fs"] } },
      context: "./context.md",
      commands: ["./commands/deploy.md"],
    };
    expect(validateManifest(manifest)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateManifest(null)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(validateManifest("hello")).toBe(false);
    expect(validateManifest(42)).toBe(false);
  });

  it("rejects a manifest missing name", () => {
    expect(validateManifest({ version: "1.0.0" })).toBe(false);
  });

  it("rejects a manifest missing version", () => {
    expect(validateManifest({ name: "ext" })).toBe(false);
  });

  it("rejects a manifest with non-string name", () => {
    expect(validateManifest({ name: 123, version: "1.0.0" })).toBe(false);
  });

  it("rejects a manifest with non-string version", () => {
    expect(validateManifest({ name: "ext", version: 1 })).toBe(false);
  });

  it("rejects a manifest with non-array tools", () => {
    expect(validateManifest({ name: "ext", version: "1.0.0", tools: "bad" })).toBe(false);
  });

  it("rejects a manifest with non-object mcpServers", () => {
    expect(validateManifest({ name: "ext", version: "1.0.0", mcpServers: [] })).toBe(false);
  });

  it("rejects mcpServers entries missing command", () => {
    expect(validateManifest({ name: "ext", version: "1.0.0", mcpServers: { fs: { args: [] } } })).toBe(false);
  });

  it("rejects a manifest with non-string context", () => {
    expect(validateManifest({ name: "ext", version: "1.0.0", context: 42 })).toBe(false);
  });

  it("rejects a manifest with non-array commands", () => {
    expect(validateManifest({ name: "ext", version: "1.0.0", commands: "bad" })).toBe(false);
  });
});

describe("loadManifest", () => {
  it("loads and validates a manifest from an extension directory", async () => {
    const manifest: ExtensionManifest = {
      name: "test-ext",
      version: "0.1.0",
      description: "A test extension",
      tools: ["./tools/hello.js"],
    };
    await writeFile(join(tempDir, "forge.extension.json"), JSON.stringify(manifest));

    const loaded = await loadManifest(tempDir);
    expect(loaded).toEqual(manifest);
  });

  it("throws when forge.extension.json does not exist", async () => {
    await expect(loadManifest(tempDir)).rejects.toThrow(/forge\.extension\.json/);
  });

  it("throws when the file is not valid JSON", async () => {
    await writeFile(join(tempDir, "forge.extension.json"), "not json{{{");
    await expect(loadManifest(tempDir)).rejects.toThrow(/not valid JSON/);
  });

  it("throws when the JSON fails validation", async () => {
    await writeFile(join(tempDir, "forge.extension.json"), JSON.stringify({ version: "1.0.0" }));
    await expect(loadManifest(tempDir)).rejects.toThrow(/invalid/i);
  });
});
