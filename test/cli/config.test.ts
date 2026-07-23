import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, requireEnv } from "../../src/cli/config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-cli-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
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
