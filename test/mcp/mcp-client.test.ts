import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
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
});
