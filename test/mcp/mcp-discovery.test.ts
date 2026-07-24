import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverMcpServers } from "../../src/mcp/mcp-discovery.js";

let projectDir: string;
let forgeHomeDir: string;
let originalForgeHome: string | undefined;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "forge-mcp-discovery-"));
  forgeHomeDir = await mkdtemp(join(tmpdir(), "forge-mcp-home-"));
  originalForgeHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = forgeHomeDir;
});

afterEach(async () => {
  if (originalForgeHome === undefined) delete process.env.FORGE_HOME;
  else process.env.FORGE_HOME = originalForgeHome;
  await rm(projectDir, { recursive: true, force: true });
  await rm(forgeHomeDir, { recursive: true, force: true });
});

describe("discoverMcpServers", () => {
  it("discovers servers from a project-level .forge/mcp.json", async () => {
    await mkdir(join(projectDir, ".forge"), { recursive: true });
    await writeFile(
      join(projectDir, ".forge", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
        },
      }),
      "utf8",
    );

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([
      { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    ]);
  });

  it("discovers servers from the global ~/.forge/mcp.json via FORGE_HOME", async () => {
    await writeFile(
      join(forgeHomeDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
        },
      }),
      "utf8",
    );

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([
      { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    ]);
  });

  it("merges global and project servers, with project overriding global by name", async () => {
    await writeFile(
      join(forgeHomeDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "global-github"] },
          shared: { command: "node", args: ["global-shared.js"] },
        },
      }),
      "utf8",
    );
    await mkdir(join(projectDir, ".forge"), { recursive: true });
    await writeFile(
      join(projectDir, ".forge", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "project-github"] },
          local: { command: "node", args: ["local.js"] },
        },
      }),
      "utf8",
    );

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([
      { name: "github", command: "npx", args: ["-y", "project-github"] },
      { name: "shared", command: "node", args: ["global-shared.js"] },
      { name: "local", command: "node", args: ["local.js"] },
    ]);
  });

  it("returns an empty array when no mcp.json files exist", async () => {
    const servers = await discoverMcpServers(projectDir);
    expect(servers).toEqual([]);
  });

  it("silently skips a missing global mcp.json when a project one exists", async () => {
    await mkdir(join(projectDir, ".forge"), { recursive: true });
    await writeFile(
      join(projectDir, ".forge", "mcp.json"),
      JSON.stringify({ mcpServers: { a: { command: "node" } } }),
      "utf8",
    );

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([{ name: "a", command: "node" }]);
  });

  it("silently skips a missing project mcp.json when a global one exists", async () => {
    await writeFile(
      join(forgeHomeDir, "mcp.json"),
      JSON.stringify({ mcpServers: { b: { command: "node" } } }),
      "utf8",
    );

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([{ name: "b", command: "node" }]);
  });

  it("gracefully handles invalid JSON in the project mcp.json", async () => {
    await mkdir(join(projectDir, ".forge"), { recursive: true });
    await writeFile(join(projectDir, ".forge", "mcp.json"), "{ not valid json", "utf8");

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([]);
  });

  it("gracefully handles invalid JSON in the global mcp.json", async () => {
    await writeFile(join(forgeHomeDir, "mcp.json"), "not json at all", "utf8");

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([]);
  });

  it("preserves env from the mcp.json config", async () => {
    await mkdir(join(projectDir, ".forge"), { recursive: true });
    await writeFile(
      join(projectDir, ".forge", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "server-github"], env: { GITHUB_TOKEN: "abc" } },
        },
      }),
      "utf8",
    );

    const servers = await discoverMcpServers(projectDir);

    expect(servers).toEqual([
      { name: "github", command: "npx", args: ["-y", "server-github"], env: { GITHUB_TOKEN: "abc" } },
    ]);
  });
});
