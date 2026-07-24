import { describe, it, expect, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildToolRegistry } from "../../src/cli/build-registry.js";

const fixtureServerPath = fileURLToPath(new URL("../fixtures/mcp-fixture-server.js", import.meta.url));

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("buildToolRegistry", () => {
  it("registers all built-in tools when no MCP servers are configured", async () => {
    const handle = await buildToolRegistry([]);
    cleanup = handle.close;

    const names = [...handle.registry.getAll().keys()].sort();
    expect(names).toEqual(["ask_question", "bash", "best_of_n", "edit_file", "glob", "grep", "load_skill", "lsp_definition", "lsp_hover", "lsp_references", "lsp_symbols", "oracle", "read_file", "repo_map", "spawn_agent", "spawn_agents", "write_file"]);
  });

  it("also registers a configured MCP server's tools, namespaced by server name", async () => {
    const handle = await buildToolRegistry([{ name: "fixture", command: "node", args: [fixtureServerPath] }]);
    cleanup = handle.close;

    expect(handle.registry.getTool("fixture__fixture_echo")).toBeDefined();
    expect(handle.registry.getTool("read_file")).toBeDefined();
  });

  it("close() shuts down every MCP connection that was opened", async () => {
    const handle = await buildToolRegistry([{ name: "fixture", command: "node", args: [fixtureServerPath] }]);

    await expect(handle.close()).resolves.not.toThrow();
    cleanup = undefined;
  });

  it("closes previously-opened MCP connections before propagating a later server's failure", async () => {
    const closeSpy = vi.spyOn(StdioClientTransport.prototype, "close");

    try {
      await expect(
        buildToolRegistry([
          { name: "fixture", command: "node", args: [fixtureServerPath] },
          { name: "fixture", command: "node", args: [fixtureServerPath] },
        ]),
      ).rejects.toThrow(/already registered/);

      // One close() from loadMcpServerIntoRegistry's own cleanup of the
      // second (failed) connection, plus one from buildToolRegistry closing
      // the first (already-successful) connection instead of leaking it.
      expect(closeSpy).toHaveBeenCalledTimes(2);
    } finally {
      closeSpy.mockRestore();
    }
  });
});
