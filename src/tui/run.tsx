import { render } from "ink";
import { App } from "./app.js";
import { findGitBranch } from "./git.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { policiesForMode } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildAgentFns } from "../cli/agent-wiring.js";
import type { TurnRunner } from "./app.js";
import type { PermissionMode } from "../permission/permission-policies.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { SessionStore } from "../session/session-store.js";
import type { Tool, OracleFn } from "../tool/tool.js";
import type { LspClient } from "../lsp/lsp-client.js";
import type { BudgetConfig } from "../agent/budget.js";
import type { CompactionConfig } from "../agent/compaction.js";
import type { VerificationConfig } from "../agent/verification-gate.js";
import type { HookConfig } from "../hooks/hooks.js";
import type { CheckpointFn } from "../agent/tool-dispatcher.js";
import type { ReasoningLevel, ReasoningSandwichConfig } from "../agent/reasoning-sandwich.js";

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
  permissionMode?: PermissionMode;
  oracle?: OracleFn;
  lsp?: LspClient;
  loadSkill?: (name: string) => Promise<string>;
  budget?: BudgetConfig;
  compaction?: CompactionConfig;
  verification?: VerificationConfig;
  checkpoint?: CheckpointFn;
  hooks?: HookConfig[];
  reasoningLevel?: ReasoningLevel;
  reasoningSandwich?: ReasoningSandwichConfig;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  // Built per turn rather than once: the gate's ask function is the App's own
  // permission prompt, which only exists inside a turn's scope, and the mode
  // it enforces can have changed since the last turn.
  const runner: TurnRunner = async ({ text, mode, onEvent, signal, ask }) => {
    const gate = new PermissionGate(policiesForMode(mode), options.autoApprove ? async () => true : ask);
    const { subagent, parallelDispatch, bestOfN } = buildAgentFns({
      provider: options.provider,
      tools: options.tools,
      session: options.session,
      gate,
      systemPrompt: options.systemPrompt,
      cwd: options.cwd,
      signal,
    });
    const checkpoint = options.checkpoint;
    return runTurn(text, {
      provider: options.provider,
      session: options.session,
      tools: options.tools,
      gate,
      systemPrompt: options.systemPrompt,
      toolContext: {
        cwd: options.cwd,
        oracle: options.oracle,
        subagent,
        parallelDispatch,
        bestOfN,
        loadSkill: options.loadSkill,
        lsp: options.lsp,
      },
      budget: options.budget,
      compaction: options.compaction,
      verification: options.verification,
      checkpoint,
      hooks: options.hooks,
      reasoningLevel: options.reasoningLevel,
      reasoningSandwich: options.reasoningSandwich,
      onEvent,
      signal,
    });
  };

  const initialMode: PermissionMode = options.permissionMode ?? (options.autoApprove ? "auto" : "ask");

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
