import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyOverrides,
  applyProfile,
  loadConfig,
  mergeConfig,
} from "../../src/cli/config.js";
import type { ForgeConfig, ConfigOverlay } from "../../src/cli/config.js";

describe("mergeConfig", () => {
  it("returns overlay values where they are set and base values elsewhere", () => {
    const base: Partial<ForgeConfig> = {
      provider: { type: "anthropic", model: "base-model" },
      maxSteps: 10,
    };
    const overlay: Partial<ForgeConfig> = { maxSteps: 20 };

    const merged = mergeConfig(base, overlay);

    expect(merged.maxSteps).toBe(20);
    expect(merged.provider).toEqual({ type: "anthropic", model: "base-model" });
  });

  // A profile that pins the model must not blow away the endpoint and key
  // variable the user already configured globally.
  it("deep-merges nested provider fields rather than replacing the whole object", () => {
    const base: Partial<ForgeConfig> = {
      provider: { type: "openai-compatible", baseUrl: "http://global.test/v1", apiKeyEnv: "GLOBAL_KEY", model: "base" },
    };
    const overlay: ConfigOverlay = { provider: { model: "overlay" } };

    const merged = mergeConfig(base, overlay);

    expect(merged.provider).toEqual({
      type: "openai-compatible",
      baseUrl: "http://global.test/v1",
      apiKeyEnv: "GLOBAL_KEY",
      model: "overlay",
    });
  });

  it("passes unspecified fields through unchanged", () => {
    const base: Partial<ForgeConfig> = {
      provider: { type: "anthropic", model: "m" },
      mcpServers: [{ name: "fs", command: "node", args: [] }],
      maxSteps: 5,
    };

    const merged = mergeConfig(base, {});

    expect(merged).toEqual(base);
  });

  it("does not mutate either input", () => {
    const base: Partial<ForgeConfig> = { provider: { type: "anthropic", model: "base" } };
    const overlay: ConfigOverlay = { provider: { model: "overlay" } };

    mergeConfig(base, overlay);

    expect(base.provider?.model).toBe("base");
    expect(overlay.provider?.model).toBe("overlay");
  });

  it("replaces arrays wholesale rather than concatenating them", () => {
    const base: Partial<ForgeConfig> = { mcpServers: [{ name: "a", command: "node", args: [] }] };
    const overlay: Partial<ForgeConfig> = { mcpServers: [{ name: "b", command: "node", args: [] }] };

    const merged = mergeConfig(base, overlay);

    expect(merged.mcpServers).toEqual([{ name: "b", command: "node", args: [] }]);
  });
});

describe("applyProfile", () => {
  const config: ForgeConfig = {
    mcpServers: [],
    provider: { type: "anthropic", model: "base-model" },
    maxSteps: 10,
    profiles: {
      fast: { provider: { model: "fast-model" }, maxSteps: 20 },
      deep: { provider: { model: "deep-model", thinking: "high" }, maxSteps: 100 },
    },
  };

  it("overlays only the fields the profile specifies", () => {
    const result = applyProfile(config, "fast");

    expect(result.provider.model).toBe("fast-model");
    expect(result.maxSteps).toBe(20);
    expect(result.provider.type).toBe("anthropic");
  });

  it("deep-merges nested provider fields from the profile", () => {
    const result = applyProfile(config, "deep");

    expect(result.provider).toEqual({ type: "anthropic", model: "deep-model", thinking: "high" });
    expect(result.maxSteps).toBe(100);
  });

  it("does not mutate the input config", () => {
    applyProfile(config, "fast");

    expect(config.provider.model).toBe("base-model");
    expect(config.maxSteps).toBe(10);
  });

  it("throws naming the available profiles when the profile does not exist", () => {
    expect(() => applyProfile(config, "nope")).toThrow(/nope/);
    expect(() => applyProfile(config, "nope")).toThrow(/fast/);
    expect(() => applyProfile(config, "nope")).toThrow(/deep/);
  });

  it("returns the config unchanged when no profiles are defined and none requested", () => {
    const bare: ForgeConfig = { mcpServers: [], provider: { type: "anthropic" } };

    expect(applyProfile(bare, "")).toEqual(bare);
  });
});

describe("applyOverrides", () => {
  const base: ForgeConfig = {
    mcpServers: [],
    provider: { type: "anthropic", model: "base-model" },
    maxSteps: 10,
  };

  it("sets a nested field via dot notation", () => {
    const result = applyOverrides(base, ["provider.model=gpt-4o"]);

    expect(result.provider.model).toBe("gpt-4o");
    expect(result.provider.type).toBe("anthropic");
  });

  it("sets a top-level field", () => {
    const result = applyOverrides(base, ["maxSteps=10"]);

    expect(result.maxSteps).toBe(10);
  });

  it("coerces boolean values", () => {
    const result = applyOverrides(base, ["provider.insecureSkipTlsVerify=true"]);

    expect(result.provider.insecureSkipTlsVerify).toBe(true);
  });

  it("coerces numeric values", () => {
    const result = applyOverrides(base, ["maxSteps=42"]);

    expect(result.maxSteps).toBe(42);
  });

  it("leaves non-numeric, non-boolean values as strings", () => {
    const result = applyOverrides(base, ["provider.model=claude-sonnet-4-20250514"]);

    expect(result.provider.model).toBe("claude-sonnet-4-20250514");
  });

  it("applies multiple overrides in order", () => {
    const result = applyOverrides(base, ["provider.model=gpt-4o", "maxSteps=10"]);

    expect(result.provider.model).toBe("gpt-4o");
    expect(result.maxSteps).toBe(10);
  });

  it("does not mutate the input config", () => {
    applyOverrides(base, ["provider.model=gpt-4o"]);

    expect(base.provider.model).toBe("base-model");
  });

  it("rejects an override without an equals sign", () => {
    expect(() => applyOverrides(base, ["provider.model"])).toThrow(/key=value/);
  });
});

describe("loadConfig with profiles and overrides", () => {
  let dir: string;
  let forgeHomeDir: string;
  let originalForgeHome: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "forge-cli-profiles-"));
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

  it("applies a profile over the project config", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        provider: { type: "anthropic", model: "project-model" },
        maxSteps: 10,
        profiles: { fast: { provider: { model: "fast-model" }, maxSteps: 20 } },
      }),
      "utf8",
    );

    const config = await loadConfig(dir, { command: "run", profile: "fast" });

    expect(config.provider.model).toBe("fast-model");
    expect(config.maxSteps).toBe(20);
    expect(config.provider.type).toBe("anthropic");
  });

  it("lets command-line flags win over the active profile", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        provider: { model: "project-model" },
        profiles: { fast: { provider: { model: "fast-model" } } },
      }),
      "utf8",
    );

    const config = await loadConfig(dir, { command: "run", profile: "fast", model: "flag-model" });

    expect(config.provider.model).toBe("flag-model");
  });

  it("lets -c overrides win over the active profile", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        provider: { model: "project-model" },
        profiles: { fast: { provider: { model: "fast-model" }, maxSteps: 20 } },
      }),
      "utf8",
    );

    const config = await loadConfig(dir, {
      command: "run",
      profile: "fast",
      configOverrides: ["provider.model=override-model"],
    });

    expect(config.provider.model).toBe("override-model");
    expect(config.maxSteps).toBe(20);
  });

  it("resolves defaults < global < project < profile < -c < flags", async () => {
    await writeFile(
      join(forgeHomeDir, "forge.config.json"),
      JSON.stringify({ provider: { type: "openai-compatible", baseUrl: "http://global.test/v1", model: "global" } }),
      "utf8",
    );
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        provider: { model: "project" },
        profiles: { deep: { provider: { model: "profile" } } },
      }),
      "utf8",
    );

    const config = await loadConfig(dir, {
      command: "run",
      profile: "deep",
      configOverrides: ["provider.baseUrl=http://override.test/v1"],
      model: "flag",
    });

    // type and baseUrl survive from lower layers; profile then -c then flag
    // each win over the layer beneath for the fields they touch.
    expect(config.provider.type).toBe("openai-compatible");
    expect(config.provider.baseUrl).toBe("http://override.test/v1");
    expect(config.provider.model).toBe("flag");
  });

  it("errors naming available profiles when --profile is unknown", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({ profiles: { fast: {}, deep: {} } }),
      "utf8",
    );

    await expect(loadConfig(dir, { command: "run", profile: "nope" })).rejects.toThrow(/fast/);
    await expect(loadConfig(dir, { command: "run", profile: "nope" })).rejects.toThrow(/deep/);
  });

  it("leaves configs without profiles working unchanged", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({ provider: { type: "openrouter", model: "anthropic/claude-3.5-sonnet" } }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.provider).toEqual({ type: "openrouter", model: "anthropic/claude-3.5-sonnet" });
    expect(config.mcpServers).toEqual([]);
  });
});
