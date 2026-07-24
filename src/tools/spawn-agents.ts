import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import type { ParallelTask } from "../agent/parallel-dispatch.js";

interface TaskInput {
  task: string;
  mode?: "worker" | "advisory";
}

interface SpawnAgentsInput {
  tasks: TaskInput[];
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!context.parallelDispatch) {
    return { output: "parallelDispatch is not available in this execution context.", isError: true };
  }

  const { tasks } = (input ?? {}) as Partial<SpawnAgentsInput>;
  if (!Array.isArray(tasks) || tasks.length < 2) {
    return { output: "At least 2 tasks are required.", isError: true };
  }

  const parallelTasks: ParallelTask[] = tasks.map((t, i) => ({
    id: `agent-${i + 1}`,
    task: t.task,
    mode: t.mode ?? "worker",
    useWorktree: (t.mode ?? "worker") === "worker",
  }));

  const results = await context.parallelDispatch(parallelTasks, context.cwd);

  const lines = results.map((r) => {
    if (r.state === "succeeded") {
      return `[${r.id}] succeeded: ${r.summary ?? "(no summary)"}`;
    }
    return `[${r.id}] failed: ${r.error ?? "unknown error"}`;
  });

  return { output: lines.join("\n"), isError: false };
}

export const spawnAgentsTool: Tool = {
  name: "spawn_agents",
  description:
    "Spawn multiple subagents in parallel for independent tasks. Each runs in isolation. Worker tasks that edit files get their own git worktree to avoid conflicts. Use when you have 2+ independent tasks that can run concurrently.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task: { type: "string", description: "The task description for the subagent." },
            mode: { type: "string", enum: ["worker", "advisory"], description: "worker edits files (gets worktree isolation), advisory is read-only." },
          },
          required: ["task"],
        },
        minItems: 2,
        maxItems: 5,
      },
    },
    required: ["tasks"],
  },
  execute,
};
