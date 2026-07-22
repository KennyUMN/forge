import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildToolRegistry } from "./build-registry.js";
import { loadConfig, requireApiKey } from "./config.js";
import { askTerminal } from "./ask-terminal.js";
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
  const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, askTerminal);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const userText = await rl.question("> ");
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
