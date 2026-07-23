import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles } from "../../src/cli/env.js";

let projectDir: string;
let homeDir: string;
let originalForgeHome: string | undefined;

const TRACKED_VARS = ["FORGE_ENV_TEST_A", "FORGE_ENV_TEST_B"];

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "forge-env-project-"));
  homeDir = await mkdtemp(join(tmpdir(), "forge-env-home-"));
  originalForgeHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = homeDir;
  for (const name of TRACKED_VARS) delete process.env[name];
});

afterEach(async () => {
  if (originalForgeHome === undefined) delete process.env.FORGE_HOME;
  else process.env.FORGE_HOME = originalForgeHome;
  for (const name of TRACKED_VARS) delete process.env[name];
  await rm(projectDir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

describe("loadEnvFiles", () => {
  it("returns an empty list and throws nothing when neither file exists", () => {
    expect(loadEnvFiles(projectDir)).toEqual([]);
  });

  it("loads the user-level file so a key set once works from any directory", async () => {
    await writeFile(join(homeDir, ".env"), "FORGE_ENV_TEST_A=from-home\n", "utf8");

    const loaded = loadEnvFiles(projectDir);

    expect(process.env.FORGE_ENV_TEST_A).toBe("from-home");
    expect(loaded).toEqual([join(homeDir, ".env")]);
  });

  it("loads the project file as well as the user-level one", async () => {
    await writeFile(join(homeDir, ".env"), "FORGE_ENV_TEST_A=from-home\n", "utf8");
    await writeFile(join(projectDir, ".env"), "FORGE_ENV_TEST_B=from-project\n", "utf8");

    const loaded = loadEnvFiles(projectDir);

    expect(process.env.FORGE_ENV_TEST_A).toBe("from-home");
    expect(process.env.FORGE_ENV_TEST_B).toBe("from-project");
    expect(loaded).toHaveLength(2);
  });

  // An explicitly exported variable is the most deliberate signal available,
  // so neither file may quietly replace it -- this is process.loadEnvFile()'s
  // own behaviour, pinned here because the load order depends on it.
  it("never overwrites a variable already present in the environment", async () => {
    process.env.FORGE_ENV_TEST_A = "from-shell";
    await writeFile(join(homeDir, ".env"), "FORGE_ENV_TEST_A=from-home\n", "utf8");

    loadEnvFiles(projectDir);

    expect(process.env.FORGE_ENV_TEST_A).toBe("from-shell");
  });
});
