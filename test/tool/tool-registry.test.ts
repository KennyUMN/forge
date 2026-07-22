import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tool/tool-registry.js";
import type { Tool } from "../../src/tool/tool.js";

const fixtureUrl = new URL("../fixtures/tool-plugin-fixture.ts", import.meta.url);
const badModuleUrl = new URL("../fixtures/not-a-plugin.ts", import.meta.url);

function makeTool(name: string): Tool {
  return {
    name,
    description: name,
    parameters: {},
    async execute() {
      return { output: "ok", isError: false };
    },
  };
}

describe("ToolRegistry", () => {
  it("registers a tool and makes it retrievable by name", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("echo");

    registry.registerTool(tool);

    expect(registry.getTool("echo")).toBe(tool);
    expect(registry.getAll().get("echo")).toBe(tool);
  });

  it("throws when registering two tools with the same name", () => {
    const registry = new ToolRegistry();
    registry.registerTool(makeTool("dup"));

    expect(() => registry.registerTool(makeTool("dup"))).toThrow(/already registered/);
  });

  it("returns undefined for a tool that was never registered", () => {
    const registry = new ToolRegistry();
    expect(registry.getTool("nope")).toBeUndefined();
  });

  it("dynamically imports a real plugin module and registers the tools it exports", async () => {
    const registry = new ToolRegistry();

    await registry.loadPlugin(fixtureUrl.href);

    const tool = registry.getTool("fixture_tool");
    expect(tool).toBeDefined();
    const result = await tool!.execute({}, { cwd: "/tmp" });
    expect(result).toEqual({ output: "fixture tool executed", isError: false });
  });

  it("throws a clear error when a plugin module does not export getTools", async () => {
    const registry = new ToolRegistry();

    await expect(registry.loadPlugin(badModuleUrl.href)).rejects.toThrow(/getTools/);
  });
});
