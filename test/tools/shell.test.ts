import { describe, it, expect } from "vitest";
import { resolveShell } from "../../src/tools/shell.js";

const NEVER_EXISTS = () => false;
const ALWAYS_EXISTS = () => true;

describe("resolveShell", () => {
  it("defers to exec()'s default shell on POSIX platforms", () => {
    expect(resolveShell({ platform: "linux", env: {}, exists: ALWAYS_EXISTS })).toBeUndefined();
    expect(resolveShell({ platform: "darwin", env: {}, exists: ALWAYS_EXISTS })).toBeUndefined();
  });

  it("honours FORGE_SHELL on every platform without checking that it exists", () => {
    const env = { FORGE_SHELL: "/usr/bin/zsh" };

    expect(resolveShell({ platform: "linux", env, exists: NEVER_EXISTS })).toBe("/usr/bin/zsh");
    expect(resolveShell({ platform: "win32", env, exists: NEVER_EXISTS })).toBe("/usr/bin/zsh");
  });

  it("resolves Git Bash from a Git install already on PATH", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PATH: "C:\\Windows\\system32;C:\\Program Files\\Git\\cmd" },
      exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
    });

    expect(shell).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  it("resolves Git Bash from a PATH entry pointing at the install's bin directory", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PATH: "C:\\Tools\\Git\\mingw64\\bin" },
      exists: (path) => path === "C:\\Tools\\Git\\bin\\bash.exe",
    });

    expect(shell).toBe("C:\\Tools\\Git\\bin\\bash.exe");
  });

  it("falls back to well-known install locations when Git is not on PATH", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PATH: "C:\\Windows\\system32", ProgramFiles: "C:\\Program Files" },
      exists: (path) => path === "C:\\Program Files\\Git\\bin\\bash.exe",
    });

    expect(shell).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  // System32\bash.exe is the WSL launcher: it runs against a different
  // filesystem root, so a cwd handed to it would not mean what the caller
  // intended. It must never be picked up, even though it is on PATH and exists.
  it("never resolves to WSL's bash.exe in System32", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PATH: "C:\\Windows\\system32" },
      exists: ALWAYS_EXISTS,
    });

    expect(shell).toBeUndefined();
  });

  it("returns undefined on Windows when no POSIX shell is installed", () => {
    const shell = resolveShell({
      platform: "win32",
      env: { PATH: "C:\\Windows\\system32", ProgramFiles: "C:\\Program Files" },
      exists: NEVER_EXISTS,
    });

    expect(shell).toBeUndefined();
  });
});
