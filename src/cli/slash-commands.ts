import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

export interface SlashCommand {
  name: string;
  template: string;
  description: string;
}

export async function discoverSlashCommands(cwd: string): Promise<SlashCommand[]> {
  const dir = join(cwd, ".forge", "commands");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const results: SlashCommand[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const name = basename(entry, ".md");
    let template: string;
    try {
      template = await readFile(join(dir, entry), "utf-8");
    } catch {
      continue;
    }
    const firstLine = template.split("\n")[0] ?? "";
    results.push({ name, template, description: firstLine });
  }
  return results;
}

function runShellCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", command], { cwd, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout.trimEnd());
    });
  });
}

export async function expandSlashCommand(input: string, commands: SlashCommand[], cwd: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return input;

  const spaceIdx = trimmed.indexOf(" ");
  const commandName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  const command = commands.find((c) => c.name === commandName);
  if (!command) return input;

  // Function replacers throughout: a literal "$1", "$&", or "$$" in the
  // arguments, a file's contents, or a command's output must be inserted
  // verbatim, not interpreted as a String.replace substitution pattern.
  let expanded = command.template.replace(/\$ARGUMENTS/g, () => args);

  const filePattern = /@([\w./-]+)/g;
  let fileMatch: RegExpExecArray | null;
  const fileReplacements: Array<{ match: string; content: string }> = [];
  while ((fileMatch = filePattern.exec(expanded)) !== null) {
    const filePath = fileMatch[1]!;
    let content: string;
    try {
      content = await readFile(join(cwd, filePath), "utf-8");
    } catch {
      content = `[file not found: ${filePath}]`;
    }
    fileReplacements.push({ match: fileMatch[0], content });
  }
  for (const { match, content } of fileReplacements) {
    expanded = expanded.replace(match, () => content);
  }

  const cmdPattern = /!`([^`]+)`/g;
  let cmdMatch: RegExpExecArray | null;
  const cmdReplacements: Array<{ match: string; output: string }> = [];
  while ((cmdMatch = cmdPattern.exec(expanded)) !== null) {
    const shellCmd = cmdMatch[1]!;
    let output: string;
    try {
      output = await runShellCommand(shellCmd, cwd);
    } catch {
      output = `[command failed: ${shellCmd}]`;
    }
    cmdReplacements.push({ match: cmdMatch[0], output });
  }
  for (const { match, output } of cmdReplacements) {
    expanded = expanded.replace(match, () => output);
  }

  return expanded;
}
