import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, requireApiKey } from "../../src/cli/config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-cli-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty mcpServers list when no config file exists", async () => {
    const config = await loadConfig(dir);
    expect(config).toEqual({ mcpServers: [] });
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
  });

  it("defaults mcpServers to an empty array if the config file omits it", async () => {
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({}), "utf8");

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([]);
  });
});

describe("requireApiKey", () => {
  it("returns the API key when ANTHROPIC_API_KEY is set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      expect(requireApiKey()).toBe("test-key");
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("throws a clear error when ANTHROPIC_API_KEY is not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => requireApiKey()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
