import { render } from "ink";
import { App } from "./app.js";
import { findGitBranch } from "./git.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { policiesForMode } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import type { TurnRunner } from "./app.js";
import type { PermissionMode } from "../permission/permission-policies.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { SessionStore } from "../session/session-store.js";
import type { Tool } from "../tool/tool.js";

// Used when the configured provider does not say. Deliberately conservative:
// an over-large denominator makes the bar read comfortable right up to the
// turn that fails on context length.
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export interface RunTuiOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  cwd: string;
  systemPrompt: string;
  model: string;
  version: string;
  contextWindow?: number;
  autoApprove?: boolean;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  // Built per turn rather than once: the gate's ask function is the App's own
  // permission prompt, which only exists inside a turn's scope, and the mode
  // it enforces can have changed since the last turn.
  const runner: TurnRunner = async ({ text, mode, onEvent, signal, ask }) => {
    const gate = new PermissionGate(policiesForMode(mode), options.autoApprove ? async () => true : ask);
    return runTurn(text, {
      provider: options.provider,
      session: options.session,
      tools: options.tools,
      gate,
      systemPrompt: options.systemPrompt,
      toolContext: { cwd: options.cwd },
      onEvent,
      signal,
    });
  };

  const initialMode: PermissionMode = options.autoApprove ? "auto" : "ask";

  const instance = render(
    <App
      version={options.version}
      provider={options.provider.name}
      model={options.model}
      cwd={options.cwd}
      branch={findGitBranch(options.cwd)}
      contextWindow={options.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
      initialMode={initialMode}
      runTurn={runner}
    />,
    // Ink installs its own Ctrl-C handling that exits the process; the App
    // needs Ctrl-C to interrupt the running turn instead, and to quit only
    // when nothing is running.
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
}
