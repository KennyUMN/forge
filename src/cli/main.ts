import { createInterface } from "node:readline/promises";
import { once } from "node:events";
import { join } from "node:path";
import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildToolRegistry } from "./build-registry.js";
import { loadConfig, requireApiKey } from "./config.js";
import { createSharedAskFn } from "./ask-terminal.js";
import { parseArgs, resolveSession } from "./resolve-session.js";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export async function main(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(cwd);
  const apiKey = requireApiKey();

  const sessionsDir = join(cwd, ".forge", "sessions");
  const session = await resolveSession(sessionsDir, args);
  console.log(`Session: ${session.sessionId}`);

  const registryHandle = await buildToolRegistry(config.mcpServers);
  const provider = new AnthropicProvider({ apiKey, model: DEFAULT_MODEL });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // rl.question() never settles if the underlying stdin stream ends while
  // it's pending (Ctrl-D / piped EOF) -- readline's "close" event fires
  // instead, with no way to plumb it through question()'s own promise. Race
  // each question() against this single "close" listener, registered once
  // outside the loop -- re-registering a new once(rl, "close") on every
  // iteration (as an earlier version of this fix did) leaks a "close" and
  // "error" listener pair per turn, which trips Node's
  // MaxListenersExceededWarning in any session with more than ~10 turns.
  // EOF resolves this to null, breaking the loop and reaching the finally
  // block (closing rl and the tool registry) instead of hanging forever --
  // and, whenever an MCP server is configured, orphaning its subprocess.
  const closed = once(rl, "close").then(() => null);

  // Share this single Interface (and its "close" signal) with the permission
  // gate instead of letting it open a second Interface on process.stdin --
  // two independent readline Interfaces on the same input stream corrupts
  // real TTY input (duplicate-echoed keystrokes) and closing either one
  // disables raw mode for the other. Racing against `closed` here too means
  // a permission prompt pending at stdin EOF resolves to "denied" instead of
  // hanging forever the same way the loop's own rl.question() call would.
  const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, createSharedAskFn(rl, closed));

  try {
    while (true) {
      const userText = await Promise.race([rl.question("> "), closed]);
      if (userText === null) break;
      const trimmed = userText.trim();
      if (trimmed.length === 0) continue;
      if (trimmed === "/exit") break;

      const result = await runTurn(userText, {
        provider,
        session,
        tools: registryHandle.registry.getAll(),
        gate,
        systemPrompt: "You are Forge, an agentic coding assistant.",
        toolContext: { cwd },
        onTextDelta: (text) => process.stdout.write(text),
      });

      process.stdout.write("\n");
      if (result.stoppedReason === "max_steps_reached") {
        console.log("(stopped: max steps reached)");
      }
    }
  } finally {
    rl.close();
    await registryHandle.close();
  }
}
