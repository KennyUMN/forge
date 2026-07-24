import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";

interface SpawnAgentInput {
  task?: string;
  mode?: "worker" | "advisory";
}

export const spawnAgentTool: Tool = {
  name: "spawn_agent",
  description:
    "Spawn a subagent to handle a self-contained task in an isolated context. The subagent gets a fresh context window and returns only a summary. Use for: research tasks, independent file edits, code exploration, or any work that would pollute your context with verbose output. Advisory subagents can only read; worker subagents can edit files.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear, self-contained task description for the subagent",
      },
      mode: {
        type: "string",
        enum: ["worker", "advisory"],
        description: "advisory = read-only research; worker = can edit files",
      },
    },
    required: ["task"],
  },
  execute: async (input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { task, mode } = input as SpawnAgentInput;

    if (!task || typeof task !== "string") {
      return { output: "Missing required field: task", isError: true };
    }

    if (!context.subagent) {
      return { output: "Subagent spawning not available", isError: true };
    }

    try {
      const result = await context.subagent(task, {
        mode: mode ?? "worker",
        maxSteps: undefined,
        model: undefined,
      });

      const output = [
        result.summary,
        `(${result.stepsExecuted} steps, ${result.toolCallsMade} tool calls, stopped: ${result.stoppedReason})`,
      ].join("\n");

      return { output, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Subagent failed: ${message}`, isError: true };
    }
  },
};
