import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, requireEnv } from "../../src/cli/config.js";

let dir: string;
let forgeHomeDir: string;
let originalForgeHome: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-cli-config-"));
  // Without this, loadConfig() reads the real ~/.forge/forge.config.json and
  // every assertion below depends on whose machine the suite runs on.
  forgeHomeDir = await mkdtemp(join(tmpdir(), "forge-cli-home-"));
  originalForgeHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = forgeHomeDir;
});

afterEach(async () => {
  if (originalForgeHome === undefined) delete process.env.FORGE_HOME;
  else process.env.FORGE_HOME = originalForgeHome;
  await rm(dir, { recursive: true, force: true });
  await rm(forgeHomeDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty mcpServers list and the default anthropic provider when no config file exists", async () => {
    const config = await loadConfig(dir);
    expect(config).toEqual({ mcpServers: [], provider: { type: "anthropic" } });
  });

  it("reads mcpServers from forge.config.json when present", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        mcpServers: [{ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }],
      }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([
      { name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    ]);
    expect(config.provider).toEqual({ type: "anthropic" });
  });

  it("defaults mcpServers to an empty array if the config file omits it", async () => {
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({}), "utf8");

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([]);
  });

  it("reads a configured provider from forge.config.json", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({ provider: { type: "openrouter", model: "anthropic/claude-3.5-sonnet" } }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" });
  });

  it("defaults provider to anthropic if the config file omits it", async () => {
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({ mcpServers: [] }), "utf8");

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({ type: "anthropic" });
  });

  it("reads the global config when the project has none", async () => {
    await writeFile(
      join(forgeHomeDir, "forge.config.json"),
      JSON.stringify({ provider: { type: "openai-compatible", baseUrl: "http://global.test/v1", model: "g" } }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({ type: "openai-compatible", baseUrl: "http://global.test/v1", model: "g" });
  });

  // Merged field by field rather than the project object replacing the global
  // one wholesale, so a repo can pin a model without also having to restate
  // the endpoint and key variable it inherits.
  it("merges the project provider over the global one field by field", async () => {
    await writeFile(
      join(forgeHomeDir, "forge.config.json"),
      JSON.stringify({
        provider: {
          type: "openai-compatible",
          baseUrl: "http://global.test/v1",
          model: "global-model",
          apiKeyEnv: "GLOBAL_KEY",
        },
      }),
      "utf8",
    );
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({ provider: { model: "project-model" } }), "utf8");

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({
      type: "openai-compatible",
      baseUrl: "http://global.test/v1",
      model: "project-model",
      apiKeyEnv: "GLOBAL_KEY",
    });
  });

  it("lets command-line flags win over both config files", async () => {
    await writeFile(
      join(forgeHomeDir, "forge.config.json"),
      JSON.stringify({ provider: { type: "openai-compatible", baseUrl: "http://global.test/v1", model: "global" } }),
      "utf8",
    );
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({ provider: { model: "project" } }), "utf8");

    const config = await loadConfig(dir, {
      command: "run",
      model: "flag-model",
      baseUrl: "http://flag.test/v1",
      insecure: true,
    });

    expect(config.provider.model).toBe("flag-model");
    expect(config.provider.baseUrl).toBe("http://flag.test/v1");
    expect(config.provider.insecureSkipTlsVerify).toBe(true);
  });

  // "these servers" not "these as well as the global ones" -- concatenating
  // would spawn subprocesses the project never asked for.
  it("replaces rather than concatenates mcpServers when the project defines them", async () => {
    await writeFile(
      join(forgeHomeDir, "forge.config.json"),
      JSON.stringify({ mcpServers: [{ name: "global", command: "node", args: [] }] }),
      "utf8",
    );
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({ mcpServers: [{ name: "project", command: "node", args: [] }] }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([{ name: "project", command: "node", args: [] }]);
  });

  it("throws an error naming the file when a config file is not valid JSON", async () => {
    await writeFile(join(dir, "forge.config.json"), "{ not json", "utf8");

    await expect(loadConfig(dir)).rejects.toThrow(/forge\.config\.json is not valid JSON/);
  });
});

describe("requireEnv", () => {
  it("returns the value when the given env var is set", () => {
    const original = process.env.FORGE_TEST_VAR;
    process.env.FORGE_TEST_VAR = "test-value";
    try {
      expect(requireEnv("FORGE_TEST_VAR")).toBe("test-value");
    } finally {
      if (original === undefined) delete process.env.FORGE_TEST_VAR;
      else process.env.FORGE_TEST_VAR = original;
    }
  });

  it("throws a clear error naming the env var when it is not set", () => {
    const original = process.env.FORGE_TEST_VAR;
    delete process.env.FORGE_TEST_VAR;
    try {
      expect(() => requireEnv("FORGE_TEST_VAR")).toThrow(/FORGE_TEST_VAR/);
    } finally {
      if (original !== undefined) process.env.FORGE_TEST_VAR = original;
    }
  });
});
