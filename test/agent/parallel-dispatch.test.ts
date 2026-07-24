import { describe, it, expect, vi } from "vitest";
import { dispatchParallel } from "../../src/agent/parallel-dispatch.js";
import type { ParallelTask } from "../../src/agent/parallel-dispatch.js";

describe("dispatchParallel", () => {
  it("runs all tasks concurrently and returns results with succeeded state", async () => {
    const tasks: ParallelTask[] = [
      { id: "a", task: "task a", mode: "advisory", useWorktree: false },
      { id: "b", task: "task b", mode: "advisory", useWorktree: false },
    ];
    const runTask = vi.fn(async (task: string) => `done: ${task}`);

    const results = await dispatchParallel(tasks, runTask, "/tmp");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: "a", state: "succeeded", summary: "done: task a" });
    expect(results[1]).toEqual({ id: "b", state: "succeeded", summary: "done: task b" });
    expect(runTask).toHaveBeenCalledTimes(2);
  });

  it("reports failed state when a task throws", async () => {
    const tasks: ParallelTask[] = [
      { id: "ok", task: "good", mode: "advisory", useWorktree: false },
      { id: "bad", task: "bad", mode: "worker", useWorktree: false },
    ];
    const runTask = vi.fn(async (task: string) => {
      if (task === "bad") throw new Error("exploded");
      return "fine";
    });

    const results = await dispatchParallel(tasks, runTask, "/tmp");

    const okResult = results.find((r) => r.id === "ok");
    const badResult = results.find((r) => r.id === "bad");
    expect(okResult!.state).toBe("succeeded");
    expect(badResult!.state).toBe("failed");
    expect(badResult!.error).toContain("exploded");
  });

  it("passes the worktree path as cwd for useWorktree tasks", async () => {
    const tasks: ParallelTask[] = [
      { id: "wt", task: "edit files", mode: "worker", useWorktree: true },
    ];
    const cwds: string[] = [];
    const runTask = vi.fn(async (_task: string, _mode: string, cwd: string) => {
      cwds.push(cwd);
      return "done";
    });

    const results = await dispatchParallel(tasks, runTask, process.cwd());

    expect(results[0].state).toBe("succeeded");
    expect(cwds[0]).toContain(".forge/worktrees");
    expect(results[0].worktreePath).toContain(".forge/worktrees");
  });

  it("passes the main cwd for non-worktree tasks", async () => {
    const tasks: ParallelTask[] = [
      { id: "main", task: "read stuff", mode: "advisory", useWorktree: false },
    ];
    const cwds: string[] = [];
    const runTask = vi.fn(async (_task: string, _mode: string, cwd: string) => {
      cwds.push(cwd);
      return "done";
    });

    await dispatchParallel(tasks, runTask, "/some/dir");

    expect(cwds[0]).toBe("/some/dir");
  });

  it("cancels pending tasks when the abort signal fires", async () => {
    const controller = new AbortController();
    const tasks: ParallelTask[] = [
      { id: "slow", task: "slow task", mode: "worker", useWorktree: false },
    ];
    const runTask = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return "should not reach";
    });

    controller.abort();
    const results = await dispatchParallel(tasks, runTask, "/tmp", controller.signal);

    expect(results[0].state).toBe("failed");
    expect(results[0].error).toContain("abort");
  });

  it("does not mutate the input tasks array", async () => {
    const tasks: ParallelTask[] = [
      { id: "x", task: "t", mode: "advisory", useWorktree: false },
    ];
    const frozen = Object.freeze(tasks.map((t) => Object.freeze({ ...t })));
    const runTask = vi.fn(async () => "ok");

    await dispatchParallel([...frozen] as ParallelTask[], runTask, "/tmp");

    expect(frozen).toHaveLength(1);
    expect(frozen[0].id).toBe("x");
  });
});
