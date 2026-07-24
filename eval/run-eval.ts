import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { formatReport } from "./report.js";

const execFileAsync = promisify(execFile);

export interface EvalTask {
  name: string;
  prompt: string;
  verify: string;
  maxSteps?: number;
  maxTokens?: number;
}

export interface EvalTaskFile {
  name: string;
  setup: string[];
  prompt: string;
  verify: string;
  maxSteps?: number;
  maxTokens?: number;
}

export interface EvalResult {
  task: string;
  passed: boolean;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
}

const DEFAULT_MAX_TOKENS = 50_000;
const TASK_TIMEOUT_MS = 120_000;

async function runSetup(setupCommands: string[], cwd: string): Promise<void> {
  for (const cmd of setupCommands) {
    await execFileAsync("bash", ["-c", cmd], { cwd, timeout: 10_000 });
  }
}

async function runVerify(verifyCommand: string, cwd: string): Promise<{ passed: boolean; output: string }> {
  try {
    await execFileAsync("bash", ["-c", verifyCommand], { cwd, timeout: 30_000 });
    return { passed: true, output: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message || "unknown error";
    return { passed: false, output };
  }
}

interface ForgeJsonOutput {
  result: string;
  steps: number;
  stoppedReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

async function runForge(
  forgeBin: string,
  prompt: string,
  cwd: string,
  maxTokens: number,
): Promise<ForgeJsonOutput> {
  const args = [
    "exec",
    "--output-format", "json",
    "--yes",
    "--max-tokens", String(maxTokens),
    prompt,
  ];

  const { stdout } = await execFileAsync(forgeBin, args, {
    cwd,
    timeout: TASK_TIMEOUT_MS,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });

  const lines = stdout.trim().split("\n");
  const lastLine = lines[lines.length - 1];
  return JSON.parse(lastLine) as ForgeJsonOutput;
}

export async function runEvalSuite(tasks: EvalTask[], forgeBin: string): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const task of tasks) {
    const start = performance.now();
    let dir: string | undefined;

    try {
      dir = await mkdtemp(join(tmpdir(), `forge-eval-${task.name}-`));
      const maxTokens = task.maxTokens ?? DEFAULT_MAX_TOKENS;

      const forgeOutput = await runForge(forgeBin, task.prompt, dir, maxTokens);
      const { passed, output } = await runVerify(task.verify, dir);

      results.push({
        task: task.name,
        passed,
        steps: forgeOutput.steps,
        inputTokens: forgeOutput.usage.inputTokens,
        outputTokens: forgeOutput.usage.outputTokens,
        durationMs: Math.round(performance.now() - start),
        error: passed ? undefined : output.slice(0, 500),
      });
    } catch (err) {
      results.push({
        task: task.name,
        passed: false,
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      });
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return results;
}

export async function runEvalTaskFile(taskFile: EvalTaskFile, forgeBin: string): Promise<EvalResult> {
  const start = performance.now();
  let dir: string | undefined;

  try {
    dir = await mkdtemp(join(tmpdir(), `forge-eval-${taskFile.name}-`));
    await runSetup(taskFile.setup, dir);

    const maxTokens = taskFile.maxTokens ?? DEFAULT_MAX_TOKENS;
    const forgeOutput = await runForge(forgeBin, taskFile.prompt, dir, maxTokens);
    const { passed, output } = await runVerify(taskFile.verify, dir);

    return {
      task: taskFile.name,
      passed,
      steps: forgeOutput.steps,
      inputTokens: forgeOutput.usage.inputTokens,
      outputTokens: forgeOutput.usage.outputTokens,
      durationMs: Math.round(performance.now() - start),
      error: passed ? undefined : output.slice(0, 500),
    };
  } catch (err) {
    return {
      task: taskFile.name,
      passed: false,
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function loadTaskFiles(tasksDir: string): EvalTaskFile[] {
  const files = readdirSync(tasksDir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    const raw = readFileSync(join(tasksDir, f), "utf-8");
    return JSON.parse(raw) as EvalTaskFile;
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportMode = args.includes("--report");

  const projectRoot = resolve(__dirname, "..");
  const forgeBin = join(projectRoot, "bin", "forge.js");
  const tasksDir = join(__dirname, "tasks");

  const taskFiles = loadTaskFiles(tasksDir);
  console.error(`Running ${taskFiles.length} eval tasks...`);

  const results: EvalResult[] = [];
  for (const taskFile of taskFiles) {
    console.error(`  [${results.length + 1}/${taskFiles.length}] ${taskFile.name}`);
    results.push(await runEvalTaskFile(taskFile, forgeBin));
  }

  if (reportMode) {
    console.log(formatReport(results));
  } else {
    for (const r of results) {
      const status = r.passed ? "PASS" : "FAIL";
      console.log(`[${status}] ${r.task} (${r.steps} steps, ${r.inputTokens + r.outputTokens} tokens, ${r.durationMs}ms)`);
      if (r.error) console.log(`       ${r.error.split("\n")[0]}`);
    }
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${passed}/${results.length} passed`);
  }

  process.exitCode = results.every((r) => r.passed) ? 0 : 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
