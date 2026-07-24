import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fixtureServerPath = fileURLToPath(new URL("../fixtures/mcp-forge-server.js", import.meta.url));

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("Forge MCP server", () => {
  it("completes the initialize handshake", async () => {
    const transport = new StdioClientTransport({ command: "node", args: [fixtureServerPath] });
    const client = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanup = () => client.close();

    const serverInfo = client.getServerVersion();
    expect(serverInfo).toBeDefined();
    expect(serverInfo!.name).toBe("forge");
  });

  it("lists forge_agent plus built-in tools via tools/list", async () => {
    const transport = new StdioClientTransport({ command: "node", args: [fixtureServerPath] });
    const client = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanup = () => client.close();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("forge_agent");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("bash");
    expect(names).toContain("grep");
    expect(names).toContain("glob");

    const agentTool = tools.find((t) => t.name === "forge_agent");
    expect(agentTool!.description).toContain("task");
    expect(agentTool!.inputSchema).toHaveProperty("properties");
  });

  it("calls forge_agent with a task and returns the result", async () => {
    const transport = new StdioClientTransport({ command: "node", args: [fixtureServerPath] });
    const client = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanup = () => client.close();

    const result = await client.callTool({ name: "forge_agent", arguments: { task: "say hello" } });

    expect(result.content).toBeDefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("hello");
  });

  it("calls a built-in tool (read_file) via tools/call", async () => {
    const transport = new StdioClientTransport({ command: "node", args: [fixtureServerPath] });
    const client = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanup = () => client.close();

    const result = await client.callTool({
      name: "read_file",
      arguments: { file_path: fileURLToPath(new URL("../fixtures/mcp-forge-server.js", import.meta.url)) },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe("text");
    expect(content[0].text.length).toBeGreaterThan(0);
  });

  it("returns an error for unknown tools", async () => {
    const transport = new StdioClientTransport({ command: "node", args: [fixtureServerPath] });
    const client = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);
    cleanup = () => client.close();

    const result = await client.callTool({ name: "nonexistent_tool", arguments: {} });
    expect(result.isError).toBe(true);
  });
});
