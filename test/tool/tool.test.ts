import { describe, it, expect } from "vitest";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";

const echoTool: Tool = {
  name: "echo",
  description: "Echoes the input back",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute(input, _context) {
    const { text } = input as { text: string };
    return { output: text, isError: false };
  },
};

describe("Tool contract", () => {
  it("a conforming tool can be executed with input and context", async () => {
    const context: ToolExecutionContext = { cwd: "/tmp" };
    const result = await echoTool.execute({ text: "hello" }, context);
    expect(result).toEqual({ output: "hello", isError: false });
  });

  it("a tool can report an error result without throwing", async () => {
    const failingTool: Tool = {
      name: "fail",
      description: "Always fails",
      parameters: {},
      async execute() {
        return { output: "something went wrong", isError: true };
      },
    };
    const result = await failingTool.execute({}, { cwd: "/tmp" });
    expect(result.isError).toBe(true);
  });
});
