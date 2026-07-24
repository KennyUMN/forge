import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../tool/tool.js";
import type { BestOfNConfig } from "../agent/best-of-n.js";

interface BestOfNInput {
  task: string;
  n?: number;
  verifyCommand: string;
}

async function execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  if (!context.bestOfN) {
    return { output: "bestOfN is not available in this execution context.", isError: true };
  }

  const { task, n, verifyCommand } = (input ?? {}) as Partial<BestOfNInput>;

  if (!task || typeof task !== "string") {
    return { output: "A task description is required.", isError: true };
  }
  if (!verifyCommand || typeof verifyCommand !== "string") {
    return { output: "A verifyCommand is required.", isError: true };
  }

  const clampedN = Math.min(Math.max(n ?? 3, 2), 5);

  const config: BestOfNConfig = {
    n: clampedN,
    verifyCommand,
  };

  const result = await context.bestOfN(task, config);

  if (result.bestIndex === null) {
    const failures = result.trajectories.map(
      (t) => `  [${t.index}] failed (${t.steps} steps): ${t.verifyOutput ?? "no output"}`,
    );
    return {
      output: `All ${result.trajectories.length} trajectories failed verification:\n${failures.join("\n")}`,
      isError: true,
    };
  }

  const best = result.trajectories[result.bestIndex];
  return {
    output: `Best trajectory #${best.index} passed verification (${best.steps} steps):\n${best.output}`,
    isError: false,
  };
}

export const bestOfNTool: Tool = {
  name: "best_of_n",
  description:
    "Run N parallel trajectories for a task and keep the first one whose verify command passes. Useful for exploring multiple approaches to a problem and selecting the one that works.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task to attempt." },
      n: { type: "number", minimum: 2, maximum: 5, description: "Number of trajectories to run (2-5, default 3)." },
      verifyCommand: { type: "string", description: "Shell command that exits 0 if the trajectory succeeded." },
    },
    required: ["task", "verifyCommand"],
  },
  execute,
};
