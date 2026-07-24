import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface LoadSkillInput {
  name?: string;
}

export const loadSkillTool: Tool = {
  name: "load_skill",
  description: "Load the full content of a skill by name. Skills provide specialized knowledge and workflows.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the skill to load",
      },
    },
    required: ["name"],
  },
  execute: async (input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { name } = (input ?? {}) as LoadSkillInput;

    if (!name || typeof name !== "string") {
      return { output: "Missing required field: name", isError: true };
    }

    if (!context.loadSkill) {
      return { output: "Skill loading is not available in this context.", isError: true };
    }

    try {
      const body = await context.loadSkill(name);
      return { output: body, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Skill not found: ${message}`, isError: true };
    }
  },
};
