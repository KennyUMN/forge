import { describe, it, expect, vi } from "vitest";
import { spawnAgentsTool } from "../../src/tools/spawn-agents.js";
import type { ToolExecutionContext } from "../../src/tool/tool.js";
import type { ParallelResult } from "../../src/agent/parallel-dispatch.js";

describe("spawnAgentsTool", () => {
  it("has the correct name and schema", () => {
    expect(spawnAgentsTool.name).toBe("spawn_agents");
    expect(spawnAgentsTool.parameters).toEqual(
      expect.objectContaining({
        type: "object",
        required: ["tasks"],
      }),
    );
    const props = (spawnAgentsTool.parameters as any).properties;
    expect(props.tasks.type).toBe("array");
    expect(props.tasks.minItems).toBe(2);
    expect(props.tasks.maxItems).toBe(5);
  });

  it("returns a combined summary of all results", async () => {
    const mockResults: ParallelResult[] = [
      { id: "t1", state: "succeeded", summary: "did task 1" },
      { id: "t2", state: "succeeded", summary: "did task 2" },
    ];
    const parallelDispatch = vi.fn().mockResolvedValue(mockResults);
    const context: ToolExecutionContext = { cwd: "/tmp", parallelDispatch };

    const result = await spawnAgentsTool.execute(
      { tasks: [{ task: "task 1" }, { task: "task 2", mode: "advisory" }] },
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("did task 1");
    expect(result.output).toContain("did task 2");
    expect(parallelDispatch).toHaveBeenCalledTimes(1);
  });

  it("assigns worktree isolation to worker tasks and not advisory tasks", async () => {
    const parallelDispatch = vi.fn().mockResolvedValue([
      { id: "w1", state: "succeeded", summary: "ok" },
      { id: "a1", state: "succeeded", summary: "ok" },
    ]);
    const context: ToolExecutionContext = { cwd: "/tmp", parallelDispatch };

    await spawnAgentsTool.execute(
      { tasks: [{ task: "edit code", mode: "worker" }, { task: "review code", mode: "advisory" }] },
      context,
    );

    const dispatchedTasks = parallelDispatch.mock.calls[0][0];
    const worker = dispatchedTasks.find((t: any) => t.task === "edit code");
    const advisory = dispatchedTasks.find((t: any) => t.task === "review code");
    expect(worker.useWorktree).toBe(true);
    expect(advisory.useWorktree).toBe(false);
  });

  it("returns an error when parallelDispatch callback is missing", async () => {
    const context: ToolExecutionContext = { cwd: "/tmp" };

    const result = await spawnAgentsTool.execute(
      { tasks: [{ task: "a" }, { task: "b" }] },
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("parallelDispatch");
  });

  it("reports failed tasks in the output", async () => {
    const mockResults: ParallelResult[] = [
      { id: "t1", state: "succeeded", summary: "done" },
      { id: "t2", state: "failed", error: "something broke" },
    ];
    const parallelDispatch = vi.fn().mockResolvedValue(mockResults);
    const context: ToolExecutionContext = { cwd: "/tmp", parallelDispatch };

    const result = await spawnAgentsTool.execute(
      { tasks: [{ task: "a" }, { task: "b" }] },
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("succeeded");
    expect(result.output).toContain("failed");
    expect(result.output).toContain("something broke");
  });
});
