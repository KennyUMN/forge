import { describe, it, expect, vi } from "vitest";
import { spawnAgentTool } from "../../src/tools/spawn-agent.js";
import type { SubagentConfig, SubagentResult } from "../../src/agent/subagent.js";

describe("spawnAgentTool", () => {
  it("returns the subagent summary on success", async () => {
    const subagentResult: SubagentResult = {
      summary: "Found 5 matching files in src/.",
      stepsExecuted: 3,
      stoppedReason: "completed",
      toolCallsMade: 2,
    };
    const subagent = vi.fn().mockResolvedValue(subagentResult);

    const result = await spawnAgentTool.execute(
      { task: "Find all files matching *.ts", mode: "advisory" },
      { cwd: "/tmp", subagent },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("Found 5 matching files in src/.");
    expect(result.output).toContain("3 steps");
    expect(subagent).toHaveBeenCalledWith("Find all files matching *.ts", { mode: "advisory", maxSteps: undefined, model: undefined });
  });

  it("returns an error when subagent callback is not provided", async () => {
    const result = await spawnAgentTool.execute(
      { task: "Do something" },
      { cwd: "/tmp" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Subagent spawning not available");
  });

  it("defaults mode to worker", async () => {
    const subagentResult: SubagentResult = {
      summary: "Done.",
      stepsExecuted: 1,
      stoppedReason: "completed",
      toolCallsMade: 0,
    };
    const subagent = vi.fn().mockResolvedValue(subagentResult);

    await spawnAgentTool.execute(
      { task: "Edit the file" },
      { cwd: "/tmp", subagent },
    );

    expect(subagent).toHaveBeenCalledWith("Edit the file", { mode: "worker", maxSteps: undefined, model: undefined });
  });

  it("returns an error when task is missing", async () => {
    const subagent = vi.fn();
    const result = await spawnAgentTool.execute(
      {},
      { cwd: "/tmp", subagent },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("task");
    expect(subagent).not.toHaveBeenCalled();
  });

  it("has a valid schema with required task field", () => {
    const params = spawnAgentTool.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(params.type).toBe("object");
    expect(params.properties).toHaveProperty("task");
    expect(params.properties).toHaveProperty("mode");
    expect(params.required).toContain("task");
    expect(params.required).not.toContain("mode");
  });

  it("propagates subagent errors gracefully", async () => {
    const subagent = vi.fn().mockRejectedValue(new Error("Provider unavailable"));

    const result = await spawnAgentTool.execute(
      { task: "Do something" },
      { cwd: "/tmp", subagent },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Provider unavailable");
  });
});
