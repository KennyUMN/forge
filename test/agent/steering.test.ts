import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSteeringFiles, formatSteeringContext } from "../../src/agent/steering.js";
import type { SteeringFile } from "../../src/agent/steering.js";

let root: string;
let forgeHome: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forge-steering-"));
  forgeHome = join(root, "forge-home");
  await mkdir(forgeHome, { recursive: true });
  process.env["FORGE_HOME"] = forgeHome;
});

afterEach(async () => {
  delete process.env["FORGE_HOME"];
  await rm(root, { recursive: true, force: true });
});

describe("loadSteeringFiles", () => {
  it("discovers files in order: global → ancestor → project", async () => {
    const gitRoot = join(root, "repo");
    const sub = join(gitRoot, "packages", "app");
    await mkdir(sub, { recursive: true });
    await mkdir(join(gitRoot, ".git"), { recursive: true });

    await writeFile(join(forgeHome, "FORGE.md"), "global instructions");
    await writeFile(join(gitRoot, "FORGE.md"), "repo root instructions");
    await writeFile(join(gitRoot, "AGENTS.md"), "repo agents");
    await writeFile(join(gitRoot, "packages", "FORGE.md"), "packages instructions");
    await writeFile(join(sub, "FORGE.md"), "project instructions");
    await writeFile(join(sub, "AGENTS.md"), "project agents");

    const files = await loadSteeringFiles(sub);

    expect(files.map((f) => f.scope)).toEqual([
      "global",
      "ancestor",
      "ancestor",
      "ancestor",
      "project",
      "project",
    ]);
    expect(files[0]!.content).toBe("global instructions");
    expect(files[1]!.content).toBe("repo root instructions");
    expect(files[2]!.content).toBe("repo agents");
    expect(files[3]!.content).toBe("packages instructions");
    expect(files[4]!.content).toBe("project instructions");
    expect(files[5]!.content).toBe("project agents");
  });

  it("deduplicates when cwd IS the git root", async () => {
    const gitRoot = join(root, "repo");
    await mkdir(join(gitRoot, ".git"), { recursive: true });
    await writeFile(join(gitRoot, "FORGE.md"), "root instructions");
    await writeFile(join(gitRoot, "AGENTS.md"), "root agents");

    const files = await loadSteeringFiles(gitRoot);

    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.scope === "project")).toBe(true);
  });

  it("silently skips missing files", async () => {
    const cwd = join(root, "empty-project");
    await mkdir(cwd, { recursive: true });

    const files = await loadSteeringFiles(cwd);

    expect(files).toEqual([]);
  });

  it("walks to filesystem root when no git root is found", async () => {
    const cwd = join(root, "no-git", "deep");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(root, "no-git", "FORGE.md"), "ancestor file");

    const files = await loadSteeringFiles(cwd);

    const ancestorFiles = files.filter((f) => f.scope === "ancestor");
    expect(ancestorFiles.some((f) => f.content === "ancestor file")).toBe(true);
  });

  it("returns a new array on each call (immutability)", async () => {
    const cwd = join(root, "immut");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "FORGE.md"), "hello");

    const a = await loadSteeringFiles(cwd);
    const b = await loadSteeringFiles(cwd);

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("formatSteeringContext", () => {
  it("formats files with delimiters showing source path", () => {
    const files: SteeringFile[] = [
      { path: "/home/user/.forge/FORGE.md", content: "global rules", scope: "global" },
      { path: "/repo/FORGE.md", content: "project rules", scope: "project" },
    ];

    const output = formatSteeringContext(files);

    expect(output).toContain("/home/user/.forge/FORGE.md");
    expect(output).toContain("global rules");
    expect(output).toContain("/repo/FORGE.md");
    expect(output).toContain("project rules");
  });

  it("returns empty string for empty input", () => {
    expect(formatSteeringContext([])).toBe("");
  });

  it("preserves file content verbatim", () => {
    const content = "line1\nline2\n  indented";
    const files: SteeringFile[] = [{ path: "/a/FORGE.md", content, scope: "project" }];

    const output = formatSteeringContext(files);

    expect(output).toContain(content);
  });
});
