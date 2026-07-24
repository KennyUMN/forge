# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Forge is an agentic coding CLI written from scratch in TypeScript. The README is the source of truth for install, config, flags, permission modes, and built-in tools — read it. This file covers what the README does not: how the code fits together and the conventions edits must respect.

## Commands

```sh
npm test                          # vitest run (whole suite)
npx vitest run test/agent/doom-loop.test.ts   # one file
npx vitest run -t "doom loop"     # tests matching a name
npm run test:watch                # vitest in watch mode

npm run typecheck                 # source (tsc --noEmit, tsconfig.json)
npm run typecheck:test            # tests (tsconfig.test.json)
npm run build                     # tsc -> dist/, what bin/forge.js runs
```

`bin/forge.js` imports from `dist/`, so `forge` reflects the last `npm run build`, not the working tree. Rebuild after source changes before exercising the CLI binary.

## Conventions that break the build if ignored

- **ESM + NodeNext.** Every relative import must carry a `.js` extension even though the file on disk is `.ts` (`import { runTurn } from "../agent/turn-orchestrator.js"`). This is not optional.
- **TDD is the working style.** The kernel is written test-first and stays well-covered; add or update a test alongside every behavior change. Tests live under `test/` mirroring `src/`.
- **Immutability.** Follow the existing pattern — e.g. the tool dispatcher returns updated call history rather than mutating what it was handed. Prefer returning new values over in-place edits.
- **Secrets never touch config files.** `apiKeyEnv` names an environment variable; the key is loaded from `~/.forge/.env` / `./.env`. Never read or print a key value (see `printResolvedConfig`, which reports only set/NOT SET).

## Architecture

The core principle: **a headless kernel with no terminal concerns, and a CLI that is one consumer of it holding no privileges the kernel does not expose.** When adding a capability, decide first whether it belongs in the kernel (`agent`/`provider`/`permission`/`session`/`tool`/`tools`/`mcp`) or in a consumer (`cli`/`tui`). Terminal I/O, rendering, and prompting stay out of the kernel.

### The turn pipeline

`runTurn` (`src/agent/turn-orchestrator.ts`) is deliberately split into small, independently-testable units it composes in a loop (default max 50 steps):

- **step-executor** — runs *exactly one* model round-trip: consumes `provider.stream()` and accumulates text + tool calls. Does not dispatch tools or touch the session log.
- **tool-dispatcher** — runs a batch of tool calls: doom-loop check, permission evaluation, execution. Never throws for a per-call failure — a denial, unknown tool, or thrown error becomes an *error `ToolResult`* the model can see and adapt to. Returns new call history rather than mutating.
- **session-bridge** — converts the flat session log into the `Message[]` shape a provider expects, coalescing consecutive same-turn entries into one message per role (mirrors Anthropic's tool_use/tool_result grouping).
- **doom-loop** — pure guard: is this the Nth (=3) consecutive identical call?

Keep these boundaries. New agent-loop behavior generally belongs in one of these units, tested in isolation, not inlined into the orchestrator.

### Observability: the TurnEvent stream

`runTurn` emits a `TurnEvent` stream (`src/agent/turn-events.ts`) — step boundaries, text/reasoning deltas, tool calls, tool results. **A renderer never guesses what happened; it consumes this stream.** The TUI (`src/tui/`) and the CLI renderer are pure consumers. To surface something new in the UI, first ask whether it should be a `TurnEvent`.

Reasoning (`thinking_delta`) is forwarded to the event stream but *not* accumulated into the assistant text that goes back to the model on the next step.

### Sessions are a DAG, not a list

`src/session/` — an append-only JSONL log (`jsonl-log.ts`) that is torn-line tolerant: a process killed mid-write loses only its last entry, not the file (see `test/integration/kill-mid-write.test.ts`). Every `SessionEntry` carries a `parentId`, so the log is a tree. Nothing is destroyed — this is what keeps fork/rewind/non-destructive context open as future work. Sessions live per working directory under `.forge/sessions/`.

### Permission gate

`src/permission/` — every tool call passes an ordered chain of policies; the first policy returning a non-`undefined` decision (`allow`/`deny`/`ask`) wins, and `ask` calls the injected ask function. The mode (`ask`/`accept-edits`/`auto`) selects which chain. **Two guards sit outside the modes and cannot be bypassed by any mode:** a call repeated 3× identically forces a prompt, and a response truncated mid-arguments fails its tool calls rather than executing arguments nobody can vouch for.

### Providers

`src/provider/` — `ModelProvider` is a thin interface whose `stream(context)` yields provider-agnostic `StreamEvent`s. Two implementations: `anthropic-provider.ts` and `openai-compatible-provider.ts` (covers OpenRouter and any OpenAI-compatible endpoint). Optional `withThinking`/`withMaxTokens` return reconfigured providers. Add a provider by implementing this interface and wiring it into `src/cli/build-provider.ts`.

### Interruption

An `AbortSignal` is threaded from the CLI through `runTurn` into both `provider.stream()` and the `ToolExecutionContext`, and is checked between steps. A tool that can block for a long time (`bash` above all) **must** honor `context.signal`, or Ctrl-C stops the agent loop while the spawned command keeps running.

### CLI wiring ordering (fail-fast)

In `src/cli/main.ts`, `buildProvider()` runs *before* `buildToolRegistry()`: the provider throws if the API key env var is missing, and the registry spawns MCP subprocesses. Building the provider first keeps that failure fail-fast, before anything spawns — reversing them leaks an MCP subprocess whenever the key is missing. Preserve this order.

## Docs

`docs/` holds the [PRD](docs/PRD.md), [ROADMAP](docs/ROADMAP.md), and design specs + per-sprint implementation plans under `docs/superpowers/`. The design specs are the reasoning behind the structure above.
