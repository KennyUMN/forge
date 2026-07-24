import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SHADOW_BRANCH = "forge/checkpoints";

export interface Checkpoint {
  commitHash: string;
  sessionId: string;
  entryId: string;
  timestamp: string;
  toolName: string;
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function createCheckpoint(
  cwd: string,
  sessionId: string,
  entryId: string,
  toolName: string,
): Promise<Checkpoint | null> {
  if (!(await isGitRepo(cwd))) return null;

  const message = `forge-checkpoint: ${toolName} [${entryId}] session:${sessionId}`;

  try {
    await execFileAsync("git", ["add", "-A"], { cwd });
    const { stdout: treeOut } = await execFileAsync("git", ["write-tree"], { cwd });
    const tree = treeOut.trim();

    let parent: string | undefined;
    try {
      const { stdout: parentOut } = await execFileAsync("git", ["rev-parse", "--verify", SHADOW_BRANCH], { cwd });
      parent = parentOut.trim();
    } catch {
      // Shadow branch doesn't exist yet; first checkpoint has no parent.
    }

    const commitArgs = ["commit-tree", tree];
    if (parent) commitArgs.push("-p", parent);
    commitArgs.push("-m", message);
    const { stdout: commitOut } = await execFileAsync("git", commitArgs, { cwd });
    const commitHash = commitOut.trim();

    await execFileAsync("git", ["update-ref", `refs/heads/${SHADOW_BRANCH}`, commitHash], { cwd });
    await execFileAsync("git", ["reset"], { cwd });

    return {
      commitHash,
      sessionId,
      entryId,
      timestamp: new Date().toISOString(),
      toolName,
    };
  } catch {
    return null;
  }
}

export async function rewindToCheckpoint(
  cwd: string,
  checkpoint: Checkpoint,
): Promise<void> {
  await execFileAsync("git", ["checkout", checkpoint.commitHash, "--", "."], { cwd });
}

const CHECKPOINT_RE = /^forge-checkpoint: (.+?) \[(.+?)\] session:(.+)$/;

export async function listCheckpoints(cwd: string): Promise<Checkpoint[]> {
  if (!(await isGitRepo(cwd))) return [];

  let stdout: string;
  try {
    const result = await execFileAsync(
      "git",
      ["log", SHADOW_BRANCH, "--format=%H %aI %s"],
      { cwd },
    );
    stdout = result.stdout;
  } catch {
    return [];
  }

  const checkpoints: Checkpoint[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const spaceIdx = line.indexOf(" ");
    const commitHash = line.slice(0, spaceIdx);
    const rest = line.slice(spaceIdx + 1);
    const tsIdx = rest.indexOf(" ");
    const timestamp = rest.slice(0, tsIdx);
    const subject = rest.slice(tsIdx + 1);

    const match = CHECKPOINT_RE.exec(subject);
    if (!match) continue;

    checkpoints.push({
      commitHash,
      timestamp,
      toolName: match[1],
      entryId: match[2],
      sessionId: match[3],
    });
  }

  return checkpoints;
}
