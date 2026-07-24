import { runTurn } from "./turn-orchestrator.js";
import { SessionStore } from "../session/session-store.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { autoAllowReadOnlyPolicy, createDenyListPolicy } from "../permission/permission-policies.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { Tool, ToolExecutionContext, SubagentConfig, SubagentResult } from "../tool/tool.js";

export type { SubagentConfig, SubagentResult };

export type SubagentMode = "worker" | "advisory";

const DEFAULT_SUBAGENT_MAX_STEPS = 25;

const ADVISORY_TOOLS = new Set(["read_file", "grep", "glob"]);

const SUBAGENT_SYSTEM_PREAMBLE =
  "You are a subagent. Complete the following task and provide a clear, concise summary of what you did and found. Do not ask questions — work with what you have.";

export interface SubagentContext {
  parentProvider: ModelProvider;
  parentTools: ReadonlyMap<string, Tool>;
  parentSession: SessionStore;
  parentGate: PermissionGate;
  systemPrompt: string;
  cwd: string;
  signal?: AbortSignal;
}

function filterToolsForMode(tools: ReadonlyMap<string, Tool>, mode: SubagentMode): ReadonlyMap<string, Tool> {
  if (mode === "worker") return tools;
  const filtered = new Map<string, Tool>();
  for (const [name, tool] of tools) {
    if (ADVISORY_TOOLS.has(name)) {
      filtered.set(name, tool);
    }
  }
  return filtered;
}

function buildChildGate(mode: SubagentMode, parentGate: PermissionGate): PermissionGate {
  if (mode === "worker") return parentGate;
  const denyNonReadOnly = createDenyListPolicy(
    [...ADVISORY_TOOLS].length > 0 ? [] : [],
  );
  return new PermissionGate(
    [autoAllowReadOnlyPolicy, { name: "deny-all-non-readonly", evaluate: () => "deny" as const }],
    async () => false,
  );
}

export async function runSubagent(
  task: string,
  config: SubagentConfig,
  context: SubagentContext,
): Promise<SubagentResult> {
  const { parentProvider, parentTools, parentSession, parentGate, systemPrompt, cwd, signal } = context;
  const maxSteps = config.maxSteps ?? DEFAULT_SUBAGENT_MAX_STEPS;

  const parentHead = parentSession.getHeadId();
  const childSession = parentHead
    ? await SessionStore.createChild(parentSession.sessionsDir, parentHead)
    : await SessionStore.create(parentSession.sessionsDir);

  const childTools = filterToolsForMode(parentTools, config.mode);
  const childGate = buildChildGate(config.mode, parentGate);

  const childSystemPrompt = `${SUBAGENT_SYSTEM_PREAMBLE}\n\n${systemPrompt}`;

  const toolContext: ToolExecutionContext = { cwd, signal };

  let toolCallsMade = 0;
  const result = await runTurn(task, {
    provider: parentProvider,
    session: childSession,
    tools: childTools,
    gate: childGate,
    systemPrompt: childSystemPrompt,
    toolContext,
    maxSteps,
    signal,
    onEvent: (event) => {
      if (event.type === "tool_call") toolCallsMade++;
    },
  });

  return {
    summary: result.finalText,
    stepsExecuted: result.stepsExecuted,
    stoppedReason: result.stoppedReason,
    toolCallsMade,
  };
}
