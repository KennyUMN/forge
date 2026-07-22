import { describe, it, expect, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connectMcpServer, loadMcpServerIntoRegistry } from "../../src/mcp/mcp-client.js";
import { ToolRegistry } from "../../src/tool/tool-registry.js";

const fixtureServerPath = fileURLToPath(new URL("../fixtures/mcp-fixture-server.js", import.meta.url));

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("connectMcpServer", () => {
  it("connects to a real MCP server over stdio and lists its tools", async () => {
    const connection = await connectMcpServer({ name: "fixture", command: "node", args: [fixtureServerPath] });
    cleanup = connection.close;

    expect(connection.tools).toHaveLength(1);
    expect(connection.tools[0].name).toBe("fixture_echo");
  });

  it("calls a real tool on the connected server and returns its text output", async () => {
    const connection = await connectMcpServer({ name: "fixture", command: "node", args: [fixtureServerPath] });
    cleanup = connection.close;

    const tool = connection.tools[0];
    const result = await tool.execute({ text: "hello" }, { cwd: "/tmp" });

    expect(result).toEqual({ output: "echo: hello", isError: false });
  });

  it("returns an error result instead of throwing when the underlying MCP call rejects", async () => {
    const connection = await connectMcpServer({ name: "fixture", command: "node", args: [fixtureServerPath] });
    const tool = connection.tools[0];

    await connection.close();
    cleanup = undefined;

    const result = await tool.execute({ text: "hello" }, { cwd: "/tmp" });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("fixture_echo");
  });

  it("closes the spawned subprocess instead of leaking it when listTools() rejects after connect", async () => {
    const closeSpy = vi.spyOn(StdioClientTransport.prototype, "close");
    const listToolsSpy = vi
      .spyOn(Client.prototype, "listTools")
      .mockRejectedValueOnce(new Error("simulated listTools failure"));

    try {
      await expect(
        connectMcpServer({ name: "fixture", command: "node", args: [fixtureServerPath] }),
      ).rejects.toThrow(/simulated listTools failure/);

      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      listToolsSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });
});

describe("loadMcpServerIntoRegistry", () => {
  it("registers every tool from a connected MCP server into the given registry", async () => {
    const registry = new ToolRegistry();

    const connection = await loadMcpServerIntoRegistry(registry, {
      name: "fixture",
      command: "node",
      args: [fixtureServerPath],
    });
    cleanup = connection.close;

    const tool = registry.getTool("fixture_echo");
    expect(tool).toBeDefined();
    const result = await tool!.execute({ text: "hi" }, { cwd: "/tmp" });
    expect(result).toEqual({ output: "echo: hi", isError: false });
  });

  it("closes the connection instead of leaking the subprocess when a tool name collision throws during registration", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "fixture_echo",
      description: "pre-existing tool with a colliding name",
      parameters: {},
      async execute() {
        return { output: "pre-existing", isError: false };
      },
    });

    const closeSpy = vi.spyOn(StdioClientTransport.prototype, "close");

    try {
      await expect(
        loadMcpServerIntoRegistry(registry, { name: "fixture", command: "node", args: [fixtureServerPath] }),
      ).rejects.toThrow(/already registered/);

      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
    }
  });
});
