import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

// Windows ships no POSIX shell, so node:child_process' exec() falls back to
// cmd.exe there. That would force the model to write a second command dialect
// (and the system prompt to describe it) purely because of the host OS, so we
// resolve Git for Windows' bundled bash instead and keep one dialect on every
// platform.
//
// Deliberately never resolves to System32\bash.exe: that is the WSL launcher,
// which runs commands against a different filesystem root, so the cwd we hand
// it would not mean what the caller intended.

export interface ResolveShellOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

// A PATH entry belonging to a Git for Windows install -- its layout is
// <root>/cmd/git.exe, <root>/bin/bash.exe, <root>/mingw64/bin/git.exe.
const GIT_PATH_ENTRY = /[\\/]Git[\\/](cmd|bin|mingw64[\\/]bin)[\\/]?$/i;

function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];

  // Prefer an install already on PATH -- if `git` resolves there, its sibling
  // bash is the one that matches the user's actual toolchain.
  for (const entry of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed && GIT_PATH_ENTRY.test(trimmed)) {
      const root = trimmed.toLowerCase().replace(/[\\/]$/, "").endsWith("bin")
        ? dirname(dirname(trimmed))
        : dirname(trimmed);
      candidates.push(join(root, "bin", "bash.exe"));
    }
  }

  for (const base of [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (base) candidates.push(join(base, "Git", "bin", "bash.exe"));
  }
  if (env.LOCALAPPDATA) {
    candidates.push(join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
  }

  return candidates;
}

// Returns the shell to hand exec(), or undefined to accept its per-platform
// default (/bin/sh on POSIX, cmd.exe on Windows when no Git Bash is installed).
export function resolveShell(options: ResolveShellOptions = {}): string | undefined {
  const { platform = process.platform, env = process.env, exists = existsSync } = options;

  // Escape hatch, honoured on every platform: an explicitly configured shell
  // always wins, and is trusted without an existence check so that a bare
  // command name resolvable via PATH (e.g. "zsh") works.
  if (env.FORGE_SHELL) return env.FORGE_SHELL;

  if (platform !== "win32") return undefined;

  for (const candidate of gitBashCandidates(env)) {
    if (exists(candidate)) return candidate;
  }
  return undefined;
}
