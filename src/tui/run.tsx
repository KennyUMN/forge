import { render } from "ink";
import { App } from "./app.js";
import { findGitBranch } from "./git.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { policiesForMode } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildAgentFns } from "../cli/agent-wiring.js";
import { runSubagent } from "../agent/subagent.js";
import { compactEntries } from "../agent/compaction.js";
import type { SubagentContext, SubagentMode } from "../agent/subagent.js";
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
  // Enables the in-session /model command: the catalog to list, and a factory
  // that rebuilds the provider for a chosen model. Omit either and /model
  // degrades to a read-only "current model" report.
  models?: readonly string[];
  buildProviderForModel?: (model: string) => ModelProvider;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  // Mutable so /model can swap the provider mid-session and /compact can turn
  // on aggressive compaction for every subsequent turn; the runner reads the
  // current values each turn rather than closing over the originals.
  let currentProvider = options.provider;
  let compaction = options.compaction;

  // Built per turn rather than once: the gate's ask function is the App's own
  // permission prompt, which only exists inside a turn's scope, and the mode
  // it enforces can have changed since the last turn.
  const runner: TurnRunner = async ({ text, mode, onEvent, signal, ask }) => {
    const gate = new PermissionGate(policiesForMode(mode), options.autoApprove ? async () => true : ask);
    const { subagent, parallelDispatch, bestOfN } = buildAgentFns({
      provider: currentProvider,
      tools: options.tools,
      session: options.session,
      gate,
      systemPrompt: options.systemPrompt,
      cwd: options.cwd,
      signal,
    });
    const checkpoint = options.checkpoint;
    return runTurn(text, {
      provider: currentProvider,
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
      compaction,
      verification: options.verification,
      checkpoint,
      hooks: options.hooks,
      reasoningLevel: options.reasoningLevel,
      reasoningSandwich: options.reasoningSandwich,
      onEvent,
      signal,
    });
  };

  const buildProviderForModel = options.buildProviderForModel;
  const onModelChange = buildProviderForModel
    ? async (model: string): Promise<string> => {
        currentProvider = buildProviderForModel(model);
        return `model switched to ${model}`;
      }
    : undefined;

  const onCompact = async (): Promise<string> => {
    const entries = options.session.getEntries();
    // maxTokens: 0 forces a compaction now and, by staying set, keeps every
    // later turn compacting -- a manual /compact means "keep it lean".
    const config: CompactionConfig = { maxTokens: 0 };
    const result = compactEntries(entries, config);
    compaction = config;
    if (result.originalTokenEstimate === result.compactedTokenEstimate) {
      return "compaction on; nothing to stub yet (context is still small)";
    }
    return `context compacted: ~${result.originalTokenEstimate.toLocaleString("en-US")} -> ~${result.compactedTokenEstimate.toLocaleString("en-US")} tokens (older tool outputs stubbed)`;
  };

  const onAgent = async (task: string, signal: AbortSignal): Promise<string> => {
    // Worker (full tools) when the session already auto-approves; otherwise a
    // read-only advisory agent, since a worker would need permission prompts
    // that only exist inside a turn.
    const mode: SubagentMode = options.autoApprove ? "worker" : "advisory";
    const gate = new PermissionGate(policiesForMode("auto"), async () => options.autoApprove === true);
    const ctx: SubagentContext = {
      parentProvider: currentProvider,
      parentTools: options.tools,
      parentSession: options.session,
      parentGate: gate,
      systemPrompt: options.systemPrompt,
      cwd: options.cwd,
      signal,
    };
    const result = await runSubagent(task, { mode }, ctx);
    return result.summary || `subagent finished (${result.stepsExecuted} steps, no summary)`;
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
      models={options.models}
      onModelChange={onModelChange}
      onCompact={onCompact}
      onAgent={onAgent}
    />,
    // Ink installs its own Ctrl-C handling that exits the process; the App
    // needs Ctrl-C to interrupt the running turn instead, and to quit only
    // when nothing is running.
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
}
