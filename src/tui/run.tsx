import { render } from "ink";
import { App } from "./app.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import type { TurnRunner } from "./app.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { SessionStore } from "../session/session-store.js";
import type { Tool } from "../tool/tool.js";

export interface RunTuiOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  cwd: string;
  systemPrompt: string;
  model: string;
  autoApprove?: boolean;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  // Built per turn rather than once, because the gate's ask function is the
  // App's own permission prompt and only exists inside a turn's scope.
  const runner: TurnRunner = async ({ text, onEvent, signal, ask }) => {
    const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, options.autoApprove ? async () => true : ask);
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

  const instance = render(
    <App
      provider={options.provider.name}
      model={options.model}
      sessionId={options.session.sessionId}
      runTurn={runner}
    />,
    // Ink installs its own Ctrl-C handling that exits the process; the App
    // needs Ctrl-C to interrupt the running turn instead and only quit when
    // nothing is running.
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
}
