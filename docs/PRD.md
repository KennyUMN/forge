# Forge — Product Requirements Document

**Date**: 2026-07-21
**Status**: Draft, kernel phase
**Related**: [Core Kernel Design](superpowers/specs/2026-07-21-forge-kernel-design.md)

## 1. Problem

Existing open-source agentic coding CLIs each make a different set of architecture bets — provider lock-in, no plugin system, no permission model, or extensibility bolted on after the fact. None combine (a) genuine multi-model support, (b) native multi-agent orchestration, (c) a real third-party plugin ecosystem, and (d) deep local dev integration as first-class, load-bearing design decisions from day one. Forge exists to make those four things foundational rather than retrofitted.

This PRD covers only the first phase: the **core kernel** — the minimum foundation the other three differentiators (orchestration, multi-model routing, dev integrations) will be built on. It does not cover those later phases.

## 2. Goals (Kernel Phase)

- A working, self-hosting terminal coding agent: it can read/write/edit files, run shell commands, and hold a multi-turn conversation with tool use.
- A kernel that is a genuine headless library, provably separate from the CLI (no privileged coupling between them).
- A tool/plugin system that supports both native in-process tools and any existing MCP server, with no rendering/UI concerns baked into the tool contract itself.
- A model-provider abstraction thin enough to add a second provider later without touching the agent loop.
- A permission system built into the kernel by default (not opt-in), shaped as a composable policy chain.
- A session log format that survives crashes and doesn't foreclose fork/rewind later, without building fork/rewind now.

## 3. Non-Goals (Kernel Phase)

- Multi-model routing logic (only the seam for it)
- Multi-agent/sub-agent orchestration
- Sandboxed/subprocess tool isolation (native tools are in-process; MCP tools already run out-of-process via MCP's own transport)
- Git-native workflows, LSP integration, or other deep dev-tooling plugins
- Context-window compaction (structurally enabled, not implemented)
- Session fork/rewind UI (structurally enabled, not implemented)
- Any second model provider beyond Anthropic

## 4. Target Users

Phase 1: the two of us, building and dogfooding Forge on itself. Phase 2 (post-kernel): open-source contributors extending it via the plugin system and MCP. This PRD does not plan for a broader public launch — that decision comes after the kernel and at least one differentiator phase (e.g. orchestration or multi-model routing) exist.

## 5. Functional Requirements

| # | Requirement | Source component |
|---|---|---|
| FR1 | A user can start a new session and have a multi-turn conversation where the agent can call tools and see their results before responding | Agent Loop |
| FR2 | The agent refuses to execute a tool call whose arguments are ambiguous due to a truncated model response | Agent Loop |
| FR3 | If the same tool is called with identical arguments 3 times consecutively, the system forces a permission prompt regardless of policy | Agent Loop |
| FR4 | A session can be closed and later resumed with full conversation history intact | Session/Context Manager |
| FR5 | A session file that was corrupted by a crash mid-write loses only its last unwritten entry, not the whole session | Session/Context Manager |
| FR6 | Tool calls are evaluated by an ordered chain of permission policies (not a single hardcoded check), and new policies can be added without changing the gate's core logic | Permission Gate |
| FR7 | A denied tool call can carry corrective feedback back to the model instead of silently failing the turn | Permission Gate |
| FR8 | New tools can be added as npm packages without modifying kernel source | Plugin/Tool Registry |
| FR9 | Any configured MCP server's tools are available to the agent alongside native tools, indistinguishable from the model's point of view | Plugin/Tool Registry |
| FR10 | A second model provider can be added by implementing one interface, without changing the Agent Loop | ModelProvider |
| FR11 | The built-in toolset (read_file, write_file, edit_file, bash, grep/glob) is sufficient for Forge to make small edits to its own codebase | Built-in tools |

## 6. Non-Functional Requirements

- **Reliability**: no data loss beyond the last unwritten entry on crash (FR5); tool errors never crash the agent loop (they become a `tool_result` entry).
- **Extensibility**: adding a tool or an MCP server requires zero kernel source changes (FR8, FR9).
- **Portability of decisions**: the provider interface and tool contract must not couple to Anthropic-specific or CLI-specific concerns (verified structurally, not just by intent — see design spec §4.2–4.3).
- **Testability**: 80%+ coverage on kernel code per standing testing rules; every component testable in isolation with fakes/mocks before any real API integration test.

## 7. Success Criteria (Definition of Done for the Kernel Phase)

- [ ] All 11 functional requirements above have a passing automated test.
- [ ] Forge can be pointed at its own repo and asked to make and verify a real one-line code change, end-to-end, via the CLI.
- [ ] A killed-mid-write session directory reloads cleanly (FR5) — verified with an actual kill-process test, not just a unit test of the parser.
- [ ] At least one real third-party MCP server (not written by us) is connected and its tools are callable from a live session.

## 8. Roadmap

The kernel phase is split into 4 sprints — see [ROADMAP.md](ROADMAP.md) for the full breakdown, dependencies, and per-sprint definition of done. No fixed sprint length; a sprint ends when its deliverable is done and tested, not on a calendar date.

## 9. Open Questions / Risks

- **MCP client SDK choice**: the official TypeScript MCP SDK's exact API surface should be checked against its current published version before Sprint 3 starts — the design assumes it exists and is usable, not a specific version's exact call shape.
- **Anthropic SDK streaming details** (Sprint 1, Task 4): tool-call input arrives as accumulated partial JSON in the real streaming API; the plan takes the simpler, correct approach of reading complete tool-call inputs from the assembled final message rather than accumulating partial JSON live. Revisit only if a later phase needs lower tool-call latency.
- **Two-person bandwidth**: no calendar commitment is made in this PRD by design (per your call on sprint length) — the roadmap is an ordered backlog, not a schedule.
