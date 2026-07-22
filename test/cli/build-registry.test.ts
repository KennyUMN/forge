import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
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
  it("registers all six built-in tools when no MCP servers are configured", async () => {
    const handle = await buildToolRegistry([]);
    cleanup = handle.close;

    const names = [...handle.registry.getAll().keys()].sort();
    expect(names).toEqual(["bash", "edit_file", "glob", "grep", "read_file", "write_file"]);
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
});
