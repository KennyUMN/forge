import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverExtensions, installExtension } from "../../src/extension/extension-loader.js";
import type { ExtensionManifest } from "../../src/extension/manifest.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "forge-ext-loader-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeExtension(dir: string, name: string, manifest: Partial<ExtensionManifest> = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  const full: ExtensionManifest = { name, version: "1.0.0", ...manifest };
  await writeFile(join(dir, "forge.extension.json"), JSON.stringify(full));
}

describe("discoverExtensions", () => {
  it("discovers extensions from .forge/extensions/ in the cwd", async () => {
    const extDir = join(tempDir, ".forge", "extensions", "my-ext");
    await writeExtension(extDir, "my-ext", { description: "local ext" });

    const extensions = await discoverExtensions(tempDir);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].manifest.name).toBe("my-ext");
    expect(extensions[0].dir).toBe(extDir);
  });

  it("discovers extensions from the global ~/.forge/extensions/ directory", async () => {
    const globalDir = join(tempDir, "global-forge-home");
    const extDir = join(globalDir, "extensions", "global-ext");
    await writeExtension(extDir, "global-ext");

    const extensions = await discoverExtensions(tempDir, globalDir);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].manifest.name).toBe("global-ext");
  });

  it("discovers extensions from both local and global directories", async () => {
    const localExtDir = join(tempDir, ".forge", "extensions", "local-ext");
    await writeExtension(localExtDir, "local-ext");

    const globalDir = join(tempDir, "global-forge-home");
    const globalExtDir = join(globalDir, "extensions", "global-ext");
    await writeExtension(globalExtDir, "global-ext");

    const extensions = await discoverExtensions(tempDir, globalDir);
    expect(extensions).toHaveLength(2);
    const names = extensions.map((e) => e.manifest.name).sort();
    expect(names).toEqual(["global-ext", "local-ext"]);
  });

  it("returns an empty array when no extension directories exist", async () => {
    const extensions = await discoverExtensions(tempDir);
    expect(extensions).toEqual([]);
  });

  it("skips directories without a valid manifest", async () => {
    const badDir = join(tempDir, ".forge", "extensions", "bad-ext");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "forge.extension.json"), JSON.stringify({ version: "1.0.0" }));

    const goodDir = join(tempDir, ".forge", "extensions", "good-ext");
    await writeExtension(goodDir, "good-ext");

    const extensions = await discoverExtensions(tempDir);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].manifest.name).toBe("good-ext");
  });

  it("loads context content from the extension's context file", async () => {
    const extDir = join(tempDir, ".forge", "extensions", "ctx-ext");
    await writeExtension(extDir, "ctx-ext", { context: "./context.md" });
    await writeFile(join(extDir, "context.md"), "# Extra Context\nYou are helpful.");

    const extensions = await discoverExtensions(tempDir);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].contextContent).toBe("# Extra Context\nYou are helpful.");
  });
});

describe("installExtension", () => {
  it("clones a git repository into the target directory", async () => {
    const sourceRepo = join(tempDir, "source-repo");
    await mkdir(sourceRepo, { recursive: true });

    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init"], { cwd: sourceRepo, stdio: "pipe" });
    await writeExtension(sourceRepo, "installable-ext");
    execFileSync("git", ["add", "-A"], { cwd: sourceRepo, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: sourceRepo, stdio: "pipe" });

    const targetDir = join(tempDir, "installed-ext");
    await installExtension(sourceRepo, targetDir);

    const extensions = await discoverExtensions(join(tempDir, "project"), undefined, [join(tempDir, "installed-ext", "..")]);
    expect(extensions.some((e) => e.manifest.name === "installable-ext")).toBe(true);
  });
});
