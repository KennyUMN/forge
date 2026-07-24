import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_N = 5;
const DEFAULT_MAX_STEPS = 50;

export interface BestOfNConfig {
  n: number;
  verifyCommand: string;
  maxStepsPerTrajectory?: number;
}

export interface TrajectoryResult {
  index: number;
  passed: boolean;
  output: string;
  steps: number;
  verifyOutput?: string;
}

export interface BestOfNResult {
  bestIndex: number | null;
  trajectories: TrajectoryResult[];
}

export type VerifyFn = (command: string, output: string) => Promise<{ exitCode: number; output: string }>;

export async function runBestOfN(
  task: string,
  config: BestOfNConfig,
  runTrajectory: (task: string, seed: number) => Promise<{ output: string; steps: number }>,
  verifyFn?: VerifyFn,
): Promise<BestOfNResult> {
  const n = Math.min(Math.max(config.n, 1), MAX_N);
  const verify = verifyFn ?? defaultVerify;

  const trajectoryPromises = Array.from({ length: n }, (_, seed) =>
    runTrajectory(task, seed).then((result) => ({ seed, ...result })),
  );

  const settled = await Promise.allSettled(trajectoryPromises);

  const trajectories: TrajectoryResult[] = [];
  let bestIndex: number | null = null;

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];

    if (outcome.status === "rejected") {
      trajectories.push({
        index: i,
        passed: false,
        output: "",
        steps: 0,
        verifyOutput: `trajectory error: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`,
      });
      continue;
    }

    const { output, steps } = outcome.value;
    const verifyResult = await verify(config.verifyCommand, output);
    const passed = verifyResult.exitCode === 0;

    if (passed && bestIndex === null) {
      bestIndex = i;
    }

    trajectories.push({
      index: i,
      passed,
      output,
      steps,
      verifyOutput: verifyResult.output,
    });
  }

  return { bestIndex, trajectories };
}

async function defaultVerify(command: string, _output: string): Promise<{ exitCode: number; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
    return { exitCode: 0, output: [stdout, stderr].filter(Boolean).join("\n").trim() };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim()
      || execErr.message
      || "verification failed";
    return { exitCode: 1, output };
  }
}
