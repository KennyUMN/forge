# Forge Core Kernel — Design

**Date**: 2026-07-21
**Status**: Approved, pending implementation planning
**Scope**: The foundational kernel only — plugin architecture, tool-calling loop, single model provider, permission system, session management. Multi-model routing (beyond the interface seam), multi-agent orchestration, and deep dev-integration plugins (git, LSP) are explicitly out of scope and will get their own follow-on specs.

## 1. Overview & Goals

Forge is a new, open-source agentic coding CLI harness, built by studying existing open-source agentic coding tools for architecture patterns and then writing a brand-new TypeScript codebase from scratch — no shared code, no license entanglement with any studied repo.

Long-term differentiators (not all in v1, but the kernel must not foreclose them):
1. Multi-model / multi-provider routing
2. Better agent orchestration (subagents, pipelines)
3. Extensibility / plugin architecture
4. Better local dev/tool integration (git, LSP, test runners, sandboxing)

This spec covers only the **core kernel**: the plugin architecture, tool-calling loop, permission system, session management, and a provider abstraction with one real implementation. Everything else builds on top of this in later phases.

Project location: `~/Projects/Forge`. Stack: **TypeScript/Node.js**. Primary interface: **terminal CLI/TUI**, but the kernel itself is a headless library — the CLI is just its first consumer.

## 2. Research Basis

Before designing, we studied 10 open-source agentic coding tools for concrete, battle-tested architecture patterns (not to reuse their code — to learn from their decisions). Repos studied: **opencode** (anomalyco/opencode, formerly sst/opencode), **Cline**, **Aider** (Aider-AI/aider), **OpenHands** (kernel now lives in OpenHands/software-agent-sdk), **SWE-agent**, **Goose** (aaif-goose/goose, formerly block/goose), **jcode** (1jehuang/jcode), **kimi-code** (MoonshotAI/kimi-code), **pi** (earendil-works/pi), and **codex** (openai/codex).

Note: Claude Code itself is not open source and was not included in source-level research; its publicly documented behavior/conventions were referenced only where relevant.

### Key cross-repo findings

**Agent loop** — universal shape (stream model → detect tool calls → dispatch → feed results back → repeat), but nearly every studied repo's loop is a 400–1800 line god-function (Cline's `AgentRuntime`, Goose's `reply_internal`, jcode's `run_turn_interactive`). Forge should explicitly decompose this into separable units. Useful defensive patterns found: opencode's "doom loop" guard (same tool + same args 3× in a row → force a permission ask), pi's handling of truncated model output (fail tool calls rather than execute corrupted args), jcode's epoch-guarded interrupt signal (prevents a stale cancel-reset from erasing a newer cancel).

**Tool/plugin system** — in-process dynamic `import()` of npm packages is exactly what opencode, Cline, and kimi-code do. Additionally, 5 of 10 repos (OpenHands, Goose, jcode, kimi-code, Codex) layer an **MCP client** alongside native in-process tools, using MCP as the actual multi-language/third-party extensibility answer rather than inventing a bespoke protocol.

**Permission model** — the field is split. pi ships with **zero built-in permission system**, pushing safety to opt-in extensions/containerization. Every other repo builds permission into the kernel as a **composable chain of independent policy objects** rather than one big if-chain: Goose has 4 `ToolInspector`s (Permission/Security/Adversary/Egress), kimi-code has ~19 ordered `PermissionPolicy` objects, OpenHands fuses an ensemble of security analyzers. Codex uses a 4-level approval enum (`UnlessTrusted`/`OnRequest`/`Granular`/`Never`) rather than binary allow/deny.

**Session/context management** — near-universal convergence on **append-only JSONL event logs**, not a single mutable JSON file. 3 of 10 (OpenHands, pi, kimi-code's transcript system) structure entries as a **DAG** (parent-id per entry), enabling fork/branch/rewind; the rest keep it flat. Compaction is treated as a first-class kernel concern everywhere, several with two-tier strategies (full-history summarization + incremental stale-tool-output elision, e.g. Goose, opencode).

**Model-provider abstraction** — split between hand-rolled minimal interfaces (pi, kimi-code, jcode, Goose — each essentially "implement one `stream()`-shaped method") and adopting **Vercel AI SDK**'s `LanguageModelV3` as a dependency (Cline, opencode). Cline's own code notes the cost of the latter: upstream breaking changes ripple through every vendor integration. Separately, jcode and Goose each independently let a "provider" be an entirely different coding agent's CLI (wrapping Claude Code, Codex, Cursor, Copilot via each one's own protocol), extending "multi-model routing" to "multi-harness routing" — noted as a future-phase idea, not part of this spec.

**pi** (earendil-works/pi) is the single closest reference — its stated scope ("unified LLM API, agent loop, TUI, coding agent CLI") is nearly identical to Forge's own. Its agent-core package has zero TUI coupling, proven by a working headless example, and its "unified LLM API" makes providers thin, swappable values rather than a class hierarchy.

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│                  Forge CLI/TUI                   │
└───────────────────────┬───────────────────────────┘
                         │ uses (no privileged access)
┌───────────────────────▼───────────────────────────┐
│                  Forge Kernel (lib)                 │
│                                                     │
│  ┌───────────┐   ┌──────────────┐   ┌───────────┐ │
│  │  Session/  │──▶│  Agent Loop  │──▶│ Permission│ │
│  │  Context   │   │ (turn/step/  │   │   Gate    │ │
│  │  Manager   │   │ tool-dispatch│   │ (policy   │ │
│  │ (JSONL DAG)│   │  as separate │   │  chain)   │ │
│  └───────────┘   │    units)    │   └─────┬─────┘ │
│                   └──────┬───────┘         │       │
│                          ▼                  ▼       │
│                  ┌───────────────┐   ┌───────────┐ │
│                  │ ModelProvider │   │  Plugin/  │ │
│                  │  (interface)  │   │  Registry │ │
│                  └───────┬───────┘   └─────┬─────┘ │
│                          │                  │       │
│                  ┌───────▼───────┐  ┌───────▼─────┐│
│                  │ AnthropicImpl │  │ built-in    ││
│                  └───────────────┘  │ tools +     ││
│                                     │ MCP client  ││
│                                     └─────────────┘│
└─────────────────────────────────────────────────────┘
```

## 4. Components

### 4.1 Agent Loop

Decomposed into three separable, independently testable units — explicitly to avoid the god-function anti-pattern found in nearly every studied repo:

- **Turn orchestrator** — owns the outer loop across multiple model round-trips within one user turn; decides when to stop (final text response, error, abort).
- **Step executor** — one model round-trip: calls `ModelProvider.stream()`, accumulates the streamed response, classifies it (text vs. tool calls).
- **Tool dispatcher** — for each requested tool call: routes through the Permission Gate, dispatches to the Plugin Registry (or MCP client), collects the result.

Defensive behaviors built in from the start:
- **Doom-loop guard**: if the same tool is called with identical arguments 3 times in a row, force a permission `ask` regardless of policy.
- **Truncated-response handling**: if the model's response was cut off (length/stop-reason), fail the pending tool calls rather than execute possibly-corrupted arguments.
- **Interrupt/cancel correctness**: cancellation uses an epoch counter, not a bare boolean flag, so a cancel fired during an in-flight reset can't be silently erased by that reset completing afterward.

### 4.2 ModelProvider Interface

A minimal custom interface (not an external SDK dependency):

```ts
interface ModelProvider {
  readonly name: string;
  stream(context: { systemPrompt: string; messages: Message[]; tools: ToolSchema[] }): AsyncIterable<StreamEvent>;
  withThinking?(effort: ThinkingEffort): ModelProvider;   // returns a new provider, does not mutate
  withMaxTokens?(max: number): ModelProvider;             // same
}

type FinishReason = "completed" | "tool_calls" | "truncated" | "filtered" | "other";
// each provider maps its native stop reason to this enum; raw reason kept as an escape hatch
```

V1 ships one concrete implementation (`AnthropicProvider`). The interface is the seam multi-model routing inserts into later, without touching the Agent Loop.

### 4.3 Plugin/Tool Registry

- **Native tools**: npm packages, dynamically `import()`-ed at startup, each registering one or more tools via `{name, description, parameters (JSON schema), execute(input, context)}`. In-process, no subprocess isolation for v1.
- **MCP client**: Forge's tool registry also connects to configured MCP servers and exposes their tools uniformly alongside native ones. This is largely wiring against existing TypeScript MCP client SDKs, not new protocol design, and immediately makes Forge compatible with the MCP tool ecosystem already shared by Claude Code, Cline, Goose, OpenHands, kimi-code, and Codex.
- The tool contract stays a **pure execution interface** — no rendering/UI concerns baked in (this corrects a weakness found even in pi, whose `ToolDefinition` conflates TUI rendering with the execution contract). Any CLI-specific rendering hook is a separate, optional interface the CLI layer defines, not part of the core tool contract.

### 4.4 Permission Gate

A **composable chain of independent policy objects**, not a single monolithic check:

```ts
interface PermissionPolicy {
  name: string;
  evaluate(call: ToolCall, context: PermissionContext): "allow" | "deny" | "ask" | undefined;
}
```

Policies run in declared order; the first non-`undefined` result wins (matching kimi-code's ordered-chain model). V1 ships a small default chain (e.g. auto-allow read-only tools, ask before `bash`/writes), but the chain shape means new policies (rate limiting, sensitive-file guards, session-scoped "always allow" memoization) can be added without changing the gate's core logic. A denial can carry corrective feedback text back to the model (opencode's pattern) instead of just a hard stop.

### 4.5 Session/Context Manager

- **Storage**: append-only JSONL, one file per session. Not a single mutable JSON blob — no studied repo does that, and JSONL gives crash-tolerance (a torn last line can be discarded on replay without losing the rest of the session, per jcode's recovery approach) and avoids full-file rewrites on every turn.
- **Entry shape**: every entry carries `id` and `parent_id`, making the log DAG-capable (not just a flat array) so fork/branch/rewind is structurally possible later without a migration — even though v1 only ever appends linearly and ships no fork/rewind UI.
- **Resumability**: a session can be reconstructed by replaying its entry log from the root to the current head.
- **Compaction**: explicitly out of scope for v1 (see Non-Goals) — but the DAG entry shape means compaction can later be added as just another entry type (pi's model), not a destructive rewrite of the log format.

### 4.6 Built-in tools (v1 minimum set)

`read_file`, `write_file`, `edit_file` (find/replace), `bash` (shell exec), `grep`/`glob`. Enough to be a functioning, self-hosting coding agent.

## 5. Data Flow

User input → Session Manager appends a `user_message` entry → Turn Orchestrator invokes the Step Executor → Step Executor calls `ModelProvider.stream()` → response streams to the CLI as text; if it contains tool-call requests, each goes through the Tool Dispatcher → Permission Gate policy chain evaluates the call → approved calls dispatch to the matching native tool or MCP server → result appended as a `tool_result` entry (parent = the triggering `tool_call` entry) → Turn Orchestrator invokes another Step Executor round with updated context → repeats until the model returns a plain text response with no further tool calls.

## 6. Error Handling

- Tool execution errors are caught and fed back into the conversation as a `tool_result` entry carrying an error, not thrown up to crash the loop — the model sees the failure and can retry/adjust.
- Model API errors (rate limit, network, auth) surface to the CLI with a clear message and are **not** silently retried by default; retry policy is a follow-on concern.
- Permission denials produce a `tool_result` explaining the call was denied (with optional corrective feedback), so the model can adapt rather than the turn simply failing.
- If the context window is exceeded, error explicitly rather than silently truncating (compaction is a follow-on phase).

## 7. Testing Strategy

Unit tests for the Turn Orchestrator, Step Executor, Tool Dispatcher (mocked `ModelProvider`), the Permission Gate's policy-chain evaluation (policy matrix), and each built-in tool. Integration test: a scripted conversation against a real (or recorded/replayed) Anthropic API call exercising the full loop end-to-end, including at least one MCP-server-backed tool call. Target 80%+ coverage per standing testing rules.

## 8. Explicitly Out of Scope for This Spec

- Multi-model routing implementation (beyond the `ModelProvider` seam existing)
- Multi-agent/sub-agent orchestration
- Subprocess/RPC plugin isolation (native tools stay in-process for v1; MCP tools already run out-of-process via MCP's own transport)
- LSP/git-native integrations
- Context-window compaction logic (structurally enabled by the DAG entry shape, but not implemented)
- Session fork/rewind UI (structurally enabled, not implemented)
- "Multi-harness routing" (treating another agent CLI as a provider) — noted as a future idea from jcode/Goose, not part of this spec

These get their own specs once this kernel exists.

## 9. Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Combine approach | Study repos, rebuild from scratch | No license entanglement; avoids re-discovering the same bugs only if research is done properly first |
| Language | TypeScript/Node.js | Matches 4 of 6 original reference repos + pi/kimi-code; "on-distribution" for AI-assisted development, matching Claude Code's own stated rationale for staying on TS |
| Interface | Terminal CLI/TUI, kernel is a library | Validated by kimi-code's enforced CLI/agent-core import boundary and pi's headless example |
| Plugin isolation (v1) | In-process dynamic `import()` | Validated by opencode, Cline, kimi-code |
| Provider abstraction | Custom minimal interface | Matches pi (closest reference), kimi-code, jcode, Goose; avoids Cline's noted cost of coupling to an external SDK's contract |
| MCP client in v1 | Yes | 5 of 10 studied repos use MCP as their real extensibility answer; low cost via existing TS SDKs |
| Session log structure | JSONL, DAG entries (id/parent_id) | Near-universal JSONL convergence; DAG shape is cheap now vs. a real migration later (OpenHands/pi/kimi-code precedent) |
| Permission model | Composable policy chain, built into kernel | Majority pattern (Goose, kimi-code, OpenHands); pi's no-kernel-permission approach was considered and rejected as a real safety regression for Forge's default posture |
