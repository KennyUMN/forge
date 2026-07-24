import { createWorktree, mergeWorktree } from "./worktree.js";
import { mergeWithVerification } from "./worktree-merge-protocol.js";

export type AgentRunState = "pending" | "running" | "succeeded" | "failed";

export interface ParallelTask {
  id: string;
  task: string;
  mode: "worker" | "advisory";
  useWorktree: boolean;
}

export interface ParallelResult {
  id: string;
  state: AgentRunState;
  summary?: string;
  error?: string;
  worktreePath?: string;
}

export async function dispatchParallel(
  tasks: readonly ParallelTask[],
  runTask: (task: string, mode: "worker" | "advisory", cwd: string) => Promise<string>,
  cwd: string,
  signal?: AbortSignal,
  verifyCommand?: string,
): Promise<ParallelResult[]> {
  const promises = tasks.map(async (t): Promise<ParallelResult> => {
    if (signal?.aborted) {
      return { id: t.id, state: "failed", error: "aborted before start" };
    }

    if (t.useWorktree) {
      const handle = await createWorktree(cwd, t.id);
      if (!handle) {
        return { id: t.id, state: "failed", error: "failed to create worktree" };
      }

      try {
        const summary = await runTask(t.task, t.mode, handle.path);

        if (verifyCommand) {
          const merge = await mergeWithVerification(cwd, handle, verifyCommand);
          if (!merge.accepted) {
            return {
              id: t.id,
              state: "failed",
              error: merge.reason,
              worktreePath: handle.path,
            };
          }
          return { id: t.id, state: "succeeded", summary, worktreePath: handle.path };
        }

        const merge = await mergeWorktree(cwd, handle);
        if (!merge.success) {
          await handle.cleanup();
          return {
            id: t.id,
            state: "failed",
            error: `merge conflicts: ${merge.conflicts?.join(", ")}`,
            worktreePath: handle.path,
          };
        }
        return { id: t.id, state: "succeeded", summary, worktreePath: handle.path };
      } catch (err) {
        await handle.cleanup();
        const message = err instanceof Error ? err.message : String(err);
        return { id: t.id, state: "failed", error: message, worktreePath: handle.path };
      }
    }

    try {
      const summary = await runTask(t.task, t.mode, cwd);
      return { id: t.id, state: "succeeded", summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: t.id, state: "failed", error: message };
    }
  });

  const settled = await Promise.allSettled(promises);

  return settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return outcome.value;
    }
    const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    return { id: tasks[i].id, state: "failed" as const, error: message };
  });
}
