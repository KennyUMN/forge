import type { Tool } from "../../src/tool/tool.js";

const fixtureTool: Tool = {
  name: "fixture_tool",
  description:
    "A tool loaded dynamically from a fixture plugin module, used to prove ToolRegistry.loadPlugin() performs a real import().",
  parameters: { type: "object", properties: {}, required: [] },
  async execute() {
    return { output: "fixture tool executed", isError: false };
  },
};

export function getTools(): Tool[] {
  return [fixtureTool];
}
