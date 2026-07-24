import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHooks, matchesHook, runHook } from "../../src/hooks/hooks.js";
import type { HookConfig } from "../../src/hooks/hooks.js";

async function makeProjectDir(hooksJson?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forge-hooks-"));
  if (hooksJson !== undefined) {
    await mkdir(join(dir, ".forge"), { recursive: true });
    await writeFile(join(dir, ".forge", "hooks.json"), hooksJson, "utf8");
  }
  return dir;
}

describe("loadHooks", () => {
  it("loads hooks from .forge/hooks.json", async () => {
    const dir = await makeProjectDir(JSON.stringify({
      hooks: [
        { event: "pre_tool", matcher: "bash", command: "echo pre" },
        { event: "post_tool", matcher: "write_file", command: "echo post" },
      ],
    }));
    try {
      const hooks = await loadHooks(dir);
      expect(hooks).toHaveLength(2);
      expect(hooks[0]).toEqual({ event: "pre_tool", matcher: "bash", command: "echo pre" });
      expect(hooks[1]).toEqual({ event: "post_tool", matcher: "write_file", command: "echo post" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array when hooks file is missing", async () => {
    const dir = await makeProjectDir();
    try {
      const hooks = await loadHooks(dir);
      expect(hooks).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array for invalid JSON", async () => {
    const dir = await makeProjectDir("{ not valid json !!!");
    try {
      const hooks = await loadHooks(dir);
      expect(hooks).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters out invalid hook entries", async () => {
    const dir = await makeProjectDir(JSON.stringify({
      hooks: [
        { event: "pre_tool", matcher: "bash", command: "echo ok" },
        { event: "invalid_event", command: "echo bad" },
        { event: "pre_tool", command: "" },
        { event: "post_tool", command: "echo valid" },
        "not-an-object",
      ],
    }));
    try {
      const hooks = await loadHooks(dir);
      expect(hooks).toHaveLength(2);
      expect(hooks[0].command).toBe("echo ok");
      expect(hooks[1].command).toBe("echo valid");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array when hooks key is not an array", async () => {
    const dir = await makeProjectDir(JSON.stringify({ hooks: "not-an-array" }));
    try {
      const hooks = await loadHooks(dir);
      expect(hooks).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("matchesHook", () => {
  it("matches by exact tool name", () => {
    const hook: HookConfig = { event: "pre_tool", matcher: "bash", command: "echo" };
    expect(matchesHook(hook, "bash", {})).toBe(true);
    expect(matchesHook(hook, "write_file", {})).toBe(false);
  });

  it("matches by glob pattern", () => {
    const hook: HookConfig = { event: "pre_tool", matcher: "write_*", command: "echo" };
    expect(matchesHook(hook, "write_file", {})).toBe(true);
    expect(matchesHook(hook, "write_config", {})).toBe(true);
    expect(matchesHook(hook, "read_file", {})).toBe(false);
  });

  it("matches all tools when no matcher is specified", () => {
    const hook: HookConfig = { event: "pre_tool", command: "echo" };
    expect(matchesHook(hook, "bash", {})).toBe(true);
    expect(matchesHook(hook, "anything", {})).toBe(true);
  });

  it("matches by path patterns", () => {
    const hook: HookConfig = { event: "post_tool", matcher: "write_file", paths: ["src/**"], command: "echo" };
    expect(matchesHook(hook, "write_file", { path: "src/app.ts" })).toBe(true);
    expect(matchesHook(hook, "write_file", { path: "test/app.test.ts" })).toBe(false);
  });

  it("does not match when path patterns are set but input has no path", () => {
    const hook: HookConfig = { event: "post_tool", paths: ["src/**"], command: "echo" };
    expect(matchesHook(hook, "bash", { command: "ls" })).toBe(false);
  });

  it("supports file_path field for path matching", () => {
    const hook: HookConfig = { event: "post_tool", paths: ["src/**"], command: "echo" };
    expect(matchesHook(hook, "write_file", { file_path: "src/index.ts" })).toBe(true);
  });
});

describe("runHook", () => {
  it("runs a pre_tool hook and captures output", async () => {
    const hook: HookConfig = { event: "pre_tool", matcher: "bash", command: "echo hook-output" };
    const result = await runHook(hook, { toolName: "bash", input: {}, cwd: tmpdir() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hook-output");
    expect(result.blocked).toBeUndefined();
  });

  it("sets blocked=true when pre_tool hook exits non-zero", async () => {
    const hook: HookConfig = { event: "pre_tool", matcher: "bash", command: "echo denied >&2; exit 1" };
    const result = await runHook(hook, { toolName: "bash", input: {}, cwd: tmpdir() });
    expect(result.exitCode).toBe(1);
    expect(result.blocked).toBe(true);
    expect(result.stderr.trim()).toBe("denied");
  });

  it("does not set blocked for post_tool hooks even on non-zero exit", async () => {
    const hook: HookConfig = { event: "post_tool", matcher: "bash", command: "exit 1" };
    const result = await runHook(hook, { toolName: "bash", input: {}, cwd: tmpdir() });
    expect(result.exitCode).toBe(1);
    expect(result.blocked).toBeUndefined();
  });

  it("substitutes $FILE_PATH with a shell-escaped path", async () => {
    const hook: HookConfig = { event: "post_tool", command: "echo $FILE_PATH" };
    const result = await runHook(hook, { toolName: "write_file", input: { path: "src/app.ts" }, cwd: tmpdir() });
    expect(result.stdout.trim()).toBe("src/app.ts");
    expect(result.exitCode).toBe(0);
  });

  it("safely escapes paths with shell metacharacters", async () => {
    const hook: HookConfig = { event: "post_tool", command: "echo $FILE_PATH" };
    const result = await runHook(hook, { toolName: "write_file", input: { path: "file; rm -rf /.ts" }, cwd: tmpdir() });
    expect(result.stdout.trim()).toBe("file; rm -rf /.ts");
    expect(result.exitCode).toBe(0);
  });
});
