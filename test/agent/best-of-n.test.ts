import { describe, it, expect, vi } from "vitest";
import { runBestOfN } from "../../src/agent/best-of-n.js";
import type { BestOfNConfig } from "../../src/agent/best-of-n.js";

describe("runBestOfN", () => {
  const baseConfig: BestOfNConfig = {
    n: 3,
    verifyCommand: "true",
  };

  it("runs N trajectories and returns all results", async () => {
    const runTrajectory = vi.fn(async (_task: string, seed: number) => ({
      output: `result-${seed}`,
      steps: 2,
    }));

    const verify = vi.fn(async () => ({ exitCode: 0, output: "ok" }));

    const result = await runBestOfN("do something", baseConfig, runTrajectory, verify);

    expect(runTrajectory).toHaveBeenCalledTimes(3);
    expect(result.trajectories).toHaveLength(3);
    expect(result.trajectories[0].output).toBe("result-0");
    expect(result.trajectories[1].output).toBe("result-1");
    expect(result.trajectories[2].output).toBe("result-2");
  });

  it("selects the first passing trajectory", async () => {
    const runTrajectory = vi.fn(async (_task: string, seed: number) => ({
      output: `output-${seed}`,
      steps: seed + 1,
    }));

    const verify = vi.fn(async (_cmd: string, output: string) => {
      if (output === "output-1") return { exitCode: 0, output: "pass" };
      return { exitCode: 1, output: "fail" };
    });

    const result = await runBestOfN("task", baseConfig, runTrajectory, verify);

    expect(result.bestIndex).toBe(1);
    expect(result.trajectories[1].passed).toBe(true);
    expect(result.trajectories[0].passed).toBe(false);
    expect(result.trajectories[2].passed).toBe(false);
  });

  it("returns null bestIndex when all trajectories fail verification", async () => {
    const runTrajectory = vi.fn(async (_task: string, seed: number) => ({
      output: `fail-${seed}`,
      steps: 1,
    }));

    const verify = vi.fn(async () => ({ exitCode: 1, output: "always fails" }));

    const result = await runBestOfN("task", baseConfig, runTrajectory, verify);

    expect(result.bestIndex).toBeNull();
    expect(result.trajectories.every((t) => !t.passed)).toBe(true);
    expect(result.trajectories).toHaveLength(3);
  });

  it("caps N at 5 even if a higher value is requested", async () => {
    const runTrajectory = vi.fn(async (_task: string, seed: number) => ({
      output: `out-${seed}`,
      steps: 1,
    }));

    const verify = vi.fn(async () => ({ exitCode: 1, output: "nope" }));

    const config: BestOfNConfig = { n: 10, verifyCommand: "test" };
    const result = await runBestOfN("task", config, runTrajectory, verify);

    expect(runTrajectory).toHaveBeenCalledTimes(5);
    expect(result.trajectories).toHaveLength(5);
  });

  it("runs trajectories in parallel (all start before any finishes)", async () => {
    const startOrder: number[] = [];
    const endOrder: number[] = [];
    let resolvers: Array<() => void> = [];

    const runTrajectory = vi.fn(async (_task: string, seed: number) => {
      startOrder.push(seed);
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      endOrder.push(seed);
      return { output: `out-${seed}`, steps: 1 };
    });

    const verify = vi.fn(async () => ({ exitCode: 0, output: "ok" }));

    const promise = runBestOfN("task", baseConfig, runTrajectory, verify);

    await vi.waitFor(() => {
      expect(startOrder).toHaveLength(3);
    });

    expect(endOrder).toHaveLength(0);

    for (const resolve of resolvers) {
      resolve();
    }

    const result = await promise;

    expect(result.bestIndex).toBe(0);
    expect(endOrder).toHaveLength(3);
  });

  it("does not mutate the config input", async () => {
    const config: BestOfNConfig = Object.freeze({ n: 3, verifyCommand: "true" });
    const runTrajectory = vi.fn(async () => ({ output: "x", steps: 1 }));
    const verify = vi.fn(async () => ({ exitCode: 0, output: "ok" }));

    await runBestOfN("task", config, runTrajectory, verify);

    expect(config.n).toBe(3);
  });
});
