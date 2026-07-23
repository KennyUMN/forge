import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectMcpServer, loadMcpServerIntoRegistry } from "../../src/mcp/mcp-client.js";
import type { McpConnection } from "../../src/mcp/mcp-client.js";
import { ToolRegistry } from "../../src/tool/tool-registry.js";
import { readFileTool } from "../../src/tools/read-file.js";
import { writeFileTool } from "../../src/tools/write-file.js";

// PRD §7 success criterion #4: at least one real third-party MCP server (not
// written by us) is connected and its tools are callable from a live session.
// This connects to the official reference filesystem server -- an independently
// authored npm package (@modelcontextprotocol/server-filesystem) -- over the
// real stdio transport, not the in-repo fixture.
//
// It downloads the package via `npx -y` on first run, so it needs network + npx
// access and a generous timeout. Set FORGE_SKIP_NETWORK_TESTS=1 to skip it in a
// sandboxed/offline CI environment.
const shouldSkip = process.env.FORGE_SKIP_NETWORK_TESTS === "1";
const REAL_SERVER = (dirArg: string) => ({
  name: "fs",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", dirArg],
});

let dir: string;
let connection: McpConnection | { close(): Promise<void> } | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-real-mcp-"));
});

afterEach(async () => {
  if (connection) {
    await connection.close();
    connection = undefined;
  }
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(shouldSkip)("real third-party MCP server (PRD §7 #4)", () => {
  it(
    "connects over stdio, lists the server's real tools, and round-trips a write then read",
    async () => {
      const conn = await connectMcpServer(REAL_SERVER(dir));
      connection = conn;

      const toolNames = conn.tools.map((t) => t.name);
      expect(conn.tools.length).toBeGreaterThan(0);
      // The reference server exposes read_file/write_file -- the exact names
      // that collide with Forge's own built-ins (see ROADMAP Sprint 4).
      expect(toolNames).toContain("write_file");
      expect(toolNames).toContain("read_file");

      const target = join(dir, "greeting.txt");
      const content = "hello from a real third-party mcp server";

      const write = conn.tools.find((t) => t.name === "write_file")!;
      const writeResult = await write.execute({ path: target, content }, { cwd: dir });
      expect(writeResult.isError).toBe(false);

      const read = conn.tools.find((t) => t.name === "read_file")!;
      const readResult = await read.execute({ path: target }, { cwd: dir });
      expect(readResult.isError).toBe(false);
      expect(readResult.output).toContain(content);
    },
    60_000,
  );

  it(
    "loads into a shared registry namespaced, callable alongside Forge's own built-ins without collision",
    async () => {
      const registry = new ToolRegistry();
      // Register Forge's own read_file/write_file first: the real server exposes
      // the same names, so this proves namespacing prevents the collision.
      registry.registerTool(readFileTool);
      registry.registerTool(writeFileTool);

      const handle = await loadMcpServerIntoRegistry(registry, REAL_SERVER(dir));
      connection = handle;

      // Built-ins keep their bare names; the server's tools are namespaced.
      expect(registry.getTool("write_file")).toBe(writeFileTool);
      expect(registry.getTool("read_file")).toBe(readFileTool);

      const namespacedWrite = registry.getTool("fs__write_file");
      const namespacedRead = registry.getTool("fs__read_file");
      expect(namespacedWrite).toBeDefined();
      expect(namespacedRead).toBeDefined();

      const target = join(dir, "via-registry.txt");
      const content = "written through the namespaced mcp tool";
      const writeResult = await namespacedWrite!.execute({ path: target, content }, { cwd: dir });
      expect(writeResult.isError).toBe(false);

      const readResult = await namespacedRead!.execute({ path: target }, { cwd: dir });
      expect(readResult.output).toContain(content);
    },
    60_000,
  );
});
