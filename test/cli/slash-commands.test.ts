import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSlashCommands, expandSlashCommand } from "../../src/cli/slash-commands.js";
import type { SlashCommand } from "../../src/cli/slash-commands.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forge-slash-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("discoverSlashCommands", () => {
  it("discovers commands from .forge/commands/", async () => {
    const cmdDir = join(root, ".forge", "commands");
    await mkdir(cmdDir, { recursive: true });
    await writeFile(join(cmdDir, "review.md"), "Review this code for issues:\n\n@src/main.ts");

    const commands = await discoverSlashCommands(root);

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("review");
    expect(commands[0]!.description).toBe("Review this code for issues:");
    expect(commands[0]!.template).toBe("Review this code for issues:\n\n@src/main.ts");
  });

  it("returns empty array when no commands directory exists", async () => {
    const commands = await discoverSlashCommands(root);
    expect(commands).toEqual([]);
  });

  it("ignores non-.md files", async () => {
    const cmdDir = join(root, ".forge", "commands");
    await mkdir(cmdDir, { recursive: true });
    await writeFile(join(cmdDir, "notes.txt"), "not a command");
    await writeFile(join(cmdDir, "real.md"), "Do something");

    const commands = await discoverSlashCommands(root);

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("real");
  });
});

describe("expandSlashCommand", () => {
  const commands: SlashCommand[] = [
    { name: "review", template: "Review this code for issues:\n\n@$ARGUMENTS", description: "Review code" },
    { name: "greet", template: "Hello $ARGUMENTS, welcome!", description: "Greet someone" },
    { name: "status", template: "Git status:\n\n!`git status --short`", description: "Show git status" },
  ];

  it("expands $ARGUMENTS with text after the command name", async () => {
    const result = await expandSlashCommand("/greet World", commands, root);
    expect(result).toBe("Hello World, welcome!");
  });

  it("expands $ARGUMENTS as empty when no arguments given", async () => {
    const result = await expandSlashCommand("/greet", commands, root);
    expect(result).toBe("Hello , welcome!");
  });

  it("expands @file with file contents", async () => {
    await writeFile(join(root, "hello.txt"), "file content here");
    const cmds: SlashCommand[] = [
      { name: "show", template: "Contents:\n@hello.txt", description: "Show file" },
    ];

    const result = await expandSlashCommand("/show", cmds, root);
    expect(result).toBe("Contents:\nfile content here");
  });

  it("replaces @file with placeholder when file not found", async () => {
    const cmds: SlashCommand[] = [
      { name: "show", template: "Contents:\n@missing.txt", description: "Show file" },
    ];

    const result = await expandSlashCommand("/show", cmds, root);
    expect(result).toBe("Contents:\n[file not found: missing.txt]");
  });

  it("expands !`command` with command stdout", async () => {
    const result = await expandSlashCommand("/status", commands, root);
    expect(result).toContain("Git status:");
    expect(result).not.toContain("!`");
  });

  it("expands !`command` with actual output", async () => {
    const cmds: SlashCommand[] = [
      { name: "echo", template: "Output: !`echo hello`", description: "Echo test" },
    ];

    const result = await expandSlashCommand("/echo", cmds, root);
    expect(result).toBe("Output: hello");
  });

  it("passes through unknown commands unchanged", async () => {
    const result = await expandSlashCommand("/unknown arg", commands, root);
    expect(result).toBe("/unknown arg");
  });

  it("passes through non-slash input unchanged", async () => {
    const result = await expandSlashCommand("just a message", commands, root);
    expect(result).toBe("just a message");
  });

  it("handles combined $ARGUMENTS and @file expansion", async () => {
    await writeFile(join(root, "src.ts"), "const x = 1;");
    const cmds: SlashCommand[] = [
      { name: "review", template: "Review $ARGUMENTS:\n@src.ts", description: "Review" },
    ];

    const result = await expandSlashCommand("/review src.ts", cmds, root);
    expect(result).toBe("Review src.ts:\nconst x = 1;");
  });
});
