# Forge Kernel — Sprint Roadmap

**Status**: ordered backlog, no fixed sprint length — a sprint ends when its deliverable is done and tested (see [PRD.md](PRD.md) §9).

Each sprint produces working, independently testable software. Only the current/next sprint gets a full bite-sized implementation plan (per `superpowers:writing-plans`); later sprints stay at this summary level until their turn, since detailed TDD steps written today would likely need rewriting once earlier sprints land real code.

## Sprint 1 — Session Manager + ModelProvider

**Goal**: foundational data model and a single working LLM connection, each testable independently of the agent loop.

**Deliverables**:
- JSONL append/replay log with crash-tolerant recovery (torn last line discarded, not the whole file)
- `SessionStore`: create/load/append/reload a session as a DAG of entries (`id`/`parentId`)
- `ModelProvider` interface + `AnthropicProvider` implementation (streaming, finish-reason mapping, immutable `withThinking`/`withMaxTokens`)

**Depends on**: nothing (first sprint)

**Definition of done**: a session can be created, appended to, killed mid-write, and reloaded losing only the torn entry; `AnthropicProvider.stream()` produces text and tool-call events against a real Anthropic API call in a smoke test.

**Plan**: [2026-07-21-sprint-1-session-and-provider.md](superpowers/plans/2026-07-21-sprint-1-session-and-provider.md)

---

## Sprint 2 — Agent Loop + Permission Gate

**Goal**: a working conversational loop that requests tool use and gates every call through a policy chain, using Sprint 1's `SessionStore` and `ModelProvider`.

**Deliverables**:
- Turn Orchestrator / Step Executor / Tool Dispatcher, as separate testable units (not one god-function)
- Doom-loop guard (same tool + identical args 3× → forced ask)
- Truncated-response defense (fail pending tool calls rather than execute corrupted args)
- `PermissionGate` as an ordered chain of `PermissionPolicy` objects, default chain (auto-allow read-only, ask before writes/bash)
- Denial-with-corrective-feedback path back into the conversation

**Depends on**: Sprint 1 (`SessionStore`, `ModelProvider`)

**Definition of done**: a scripted conversation against a fake tool and fake provider runs end-to-end through the full loop, including one denied-then-corrected tool call and one doom-loop trigger, all as automated tests.

**Plan**: [2026-07-22-sprint-2-agent-loop-and-permission-gate.md](superpowers/plans/2026-07-22-sprint-2-agent-loop-and-permission-gate.md)

---

## Sprint 3 — Plugin/Tool Registry + MCP client + built-in tools

**Goal**: real tools wired into the Tool Dispatcher built in Sprint 2.

**Deliverables**:
- Tool Registry: in-process dynamic `import()` of npm-packaged tools, pure `{name, schema, execute()}` contract with no rendering concerns
- MCP client integration: connect to configured MCP servers, expose their tools uniformly alongside native ones
- Built-in tools: `read_file`, `write_file`, `edit_file`, `bash`, `grep`/`glob`

**Depends on**: Sprint 2 (Tool Dispatcher contract)

**Definition of done**: Forge can read, edit, and write a real file and run a real shell command through the full loop; at least one real third-party MCP server's tools appear in the tool list and are callable.

---

## Sprint 4 — CLI wiring + integration testing

**Goal**: a minimal terminal CLI that drives the kernel interactively, proving the library/CLI boundary holds in practice, not just in intent.

**Deliverables**:
- `forge` CLI entrypoint: interactive prompt, streamed output, permission prompts wired to a real terminal y/n
- Session resume by id from the CLI
- End-to-end integration test: point Forge at its own repo and have it make a real one-line change

**Depends on**: Sprint 3 (real tools), Sprint 2 (loop), Sprint 1 (sessions/provider)

**Definition of done**: all Definition of Done items in [PRD.md](PRD.md) §7 pass, including the self-hosting one-line-change test.
