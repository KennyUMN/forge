# Forge Competitive Study

**What the top agentic coding CLIs do better than Forge, and the plan to build it in.**

**Date**: 2026-07-23
**Status**: research + roadmap input (feeds [ROADMAP.md](ROADMAP.md), does not replace it)

---

## Method

Two leaderboards seeded the target list:

- **Terminal-Bench 2.0 / 2.1** (`tbench.ai`, evaluated via the **Harbor** framework) — ranks harness+model combos on real terminal tasks in isolated Docker environments. Top public entries: Codex CLI (#4, and #1 on several private research harnesses above it), Factory **Droid** (top-10), plus research harnesses (NexAU-AHE, LemonHarness, Capy, Polaris).
- **SanityHarness** (`sanityboard.lr7.dev`) — weighted per-language eval across Dart/Go/Kotlin/Rust/TS/Zig. Top: **Codex CLI** (#1), **Junie** (#2/#3), **Codex CLI** (#4), **OpenCode** (#5).

From there, 11 shipping CLIs plus the winning-harness technique literature were studied in parallel (one deep research pass each) and mapped onto Forge's architecture, then run through two synthesis lenses (roadmap builder + adversarial strategic critic).

**On the numbers.** Benchmark figures below (e.g. the 52.8% → 66.5% verification jump, the reasoning-sandwich 66.5% vs 53.9%) are **as reported** by those sources — chiefly the LangChain DeepAgents Terminal-Bench write-up. Treat them as directional evidence, not verified measurements. The *mechanisms* are what matter here.

---

## The one finding that reframes everything

> **The model is roughly 30% of a Terminal-Bench score. The rest is harness middleware.**

The gap between Forge and the leaders does **not** close by building Forge's four stated differentiators (multi-model, multi-agent, plugins, deep dev integration). It closes by building the unglamorous **loop-quality primitives** Forge currently lacks:

1. a **pre-completion verification gate** (don't let the agent stop until the tests agree),
2. **context compaction** so long runs survive the window,
3. **bounded/structured tool outputs** so one command can't poison the context,
4. **hierarchical steering memory** (`AGENTS.md`/`FORGE.md`),
5. a **headless event stream on stdout** (`forge exec --output-format stream-json`).

None of those five are on the differentiator list. They are the spine. Build the spine first, or the differentiators sit on a weak loop.

The good news: **almost every one of these drops onto a seam Forge already built.** The recurring phrase across all twelve research passes was "this ports cleanly onto an existing seam." Forge pre-built the seams the leaders had to retrofit.

---

## Where each CLI exceeds (the findings)

Each entry: its **signature technique**, the standout mechanism(s), and what a two-person team should **not** copy.

### OpenAI Codex CLI — *autonomy decoupled from trust*
- **Signature**: *escalation-on-failure*. Commands run in an OS sandbox (network off, writes scoped to cwd) with approvals set to on-failure. A sandboxed command that fails because it needs wider scope doesn't halt — it re-requests and retries wider. The agent almost never stops to ask, yet stays safe, so the loop keeps making progress where approval-gated agents stall. This is the harness reason it tops the benchmark.
- Also: **`apply_patch`** — a context-anchored, no-line-number, multi-file edit envelope. Removes the entire class of off-by-N line-number edit failures. **AGENTS.md** hierarchical memory. **Reasoning-effort dial** + named **config profiles** with layered resolution (defaults < profile < CLI). Resumable JSONL "rollout" sessions + auto-compaction.
- **Don't copy**: the multi-platform OS-sandbox matrix (Seatbelt + Landlock + seccomp + Windows tokens). Security-critical, per-OS, silent when wrong, wrong stack for TS-on-Git-Bash. Steal the *model* (autonomy behind an enforced boundary + escalate-on-failure), which Forge's permission chain can already express; wrap a container later if a real sandbox is needed.

### Anthropic Claude Code — *one extension convention, progressively disclosed*
- **Signature**: **progressive disclosure generalized**. Every capability is a filesystem-discovered file whose cheap metadata is always in context but whose expensive body loads only at the moment of relevance (skill descriptions until triggered; subagent transcripts collapsed to a summary). Context spend tracks *usage*, not *installed surface* — the one mechanism that lets a huge capability library coexist with a fixed window.
- Also: **subagents** via a Task tool (fresh context window, own allowlist, returns only a summary — context isolation as a primitive). **Hooks** as deterministic shell seams (policy becomes guaranteed, not hoped-for). **Automatic compaction**. Granular glob allowlists.
- **Don't copy**: the full extension *zoo* — five parallel plugin subsystems (hooks/skills/commands/subagents/marketplace), each its own format and lifecycle. Years of surface and a large security burden (hooks = arbitrary shell). Pick **one** filesystem-discovered format (skills-as-markdown) and express as much as possible through it.

### Aider — *empirical, git-native, pre-tool-calling*
- **Signature**: the **PageRank repo-map** — tree-sitter symbol graph across the whole codebase, PageRank personalized toward files in play, top-ranked *signatures* packed into a token budget. Turns "give the model the right code" from a retrieval guess into a graph-centrality computation.
- Also: **per-model edit formats chosen by benchmark** (whole-file for weak/local models, diffs for strong ones — edit strategy is a *per-model capability*). **architect+editor** two-model split. **Git-native safety** (auto-commit each edit, *dirty-tree-first* so `/undo` is surgical). Lint/test failure loop.
- **Don't copy**: the core edit mechanism — parsing SEARCH/REPLACE and unified diffs out of freeform model *text*. A pre-tool-calling workaround that forces a fragile per-model text-format zoo. Port the *lesson* (edit format is per-model), keep edits as **structured tool calls**.

### OpenCode — *ambient LSP as a verification loop*
- **Signature**: **LSP diagnostics wired in as an ambient post-edit loop**, not a tool the model must remember to call. After an edit, `textDocument/publishDiagnostics` errors flow straight back into context so the model self-corrects next step. "The model guessed a wrong type" goes from silent bug to immediate error.
- Also: **client/server split** (headless `opencode serve`, many clients over one API). **Provider-agnostic model layer** driven by the external **Models.dev** capability catalog (context window, price, capability flags — model choice is *data*). Structurally-enforced **Plan vs Build** mode. Non-destructive session with `/undo`, `/redo`, `/share`.
- **Don't copy**: the Effect-framework foundation and the auto-download-40+-LSP-binaries breadth. Port narrowly — one language (TypeScript / `tsc`) into the ToolResult seam — and keep one client until an HTTP adapter is genuinely demanded.

### Google Gemini CLI — *reversible edits via shadow git*
- **Signature**: **checkpoint-before-edit**. On approving any file-mutating tool, the CLI commits a snapshot to a hidden shadow git repo *and* saves the conversation + the pending tool call. `/restore` rewinds all three — files, context, and intent — a three-way rollback, not just an undo.
- Also: hierarchical **GEMINI.md** memory + `/memory show|add|reload`. **Extensions** as one git-installable manifest bundling MCP + context + commands. Grounded `web_fetch`/`web_search`.
- **Don't copy**: the actual moat — a subsidized 1M-token window and free tier. "Context-at-scale" is really "the window is big enough to skip hard compaction" — model-access capital, not engineering. Forge's durability answer is checkpoint + DAG + real compaction, not hoping the window is large enough.

### Amp (Sourcegraph) — *the cross-model second opinion*
- **Signature**: the **Oracle** — a deep-reasoning consult that is always forced onto a *different frontier model* than the main agent, advisory-only, invoked on demand. Cross-model review beats self-review because a model shares its own blind spots.
- Also: **isolated worker subagents as a context-hygiene mechanism** (fresh context in, summary out — the verbose work never pollutes the main thread). Intent modes (low/med/high/ultra) instead of a model picker.
- **Don't copy**: the hosted thread feed / workspace visibility / billing backend (a multi-person product). And don't adopt the no-model-picker dogma — it contradicts Forge's multi-model goal. Ship a local session export; keep real model choice first-class.

### Factory Droid — *risk as one monotonic dial*
- **Signature**: **risk-tiered AutoRun**. Every command/tool carries an intrinsic risk level; a single Off/Low/Med/High dial auto-approves anything at-or-below and prompts above. Risk is a property of the *action*, not a coarse mode — one knob spans the whole action space. Plus allow/deny/**block** lists with strict precedence (block is un-promptable even in auto).
- Also: headless **`droid exec`** with a JSON result envelope + fail-fast past its tier. Spec-first planning on a separate `--spec-model`.
- **Don't copy**: HyperCode/ByteRank (proprietary code index + code-tuned RAG) and the broad enterprise-connector surface. Ride MCP context providers for org context; copy the autonomy dial and the headless JSON seam, skip the index.

### JetBrains Junie — *static ground truth as tools*
- **Signature**: expose the host's **static-analysis engine as agent tools** and close the loop with it — symbol ops (find-usages, rename) resolve against a semantic index respecting scope/overloads/shadowing, and edits are verified against the IDE's inspections + tests before the turn ends. Removes the whole class of wrong-target edits that text-only agents make.
- Also: hard read-only **Ask mode** (capability restriction, not a prompt). Version-controlled `.junie/guidelines.md`. Three-tier approval (the middle **allowlist** tier kills prompt fatigue safely).
- **Don't copy**: building your own IntelliJ-grade semantic index (multi-year, the reason Junie is bolted to an IDE) or the IDE coupling itself. Consume static analysis through the neutral LSP seam; Forge's headless reach is an advantage over Junie's editor lock-in.

### Warp — *structured command I/O*
- **Signature**: **Blocks** — every command execution is a discrete addressable object bundling command + output + exit code + cwd + duration under a stable ID, not a slice of scrollback. The agent reads a Block's exit code and clean output as *data* instead of scraping a buffer — fixing the single most common failure point when an agent drives a raw shell.
- Also: plan-then-execute approval gate. Multi-agent orchestration over a message bus with explicit run-states (INPROGRESS/SUCCEEDED/FAILED/BLOCKED) + **per-agent git worktree isolation**. Warp Drive parameterized saved workflows.
- **Don't copy**: the GPU terminal emulator itself, and the server-backed message bus / cloud fan-out. Implement the same coordination semantics **in-process** over the session DAG.

### OpenHands (ex-OpenDevin) — *the agent is a function of an event log*
- **Signature**: **CodeAct** — collapse the action space to executable code run in a stateful Jupyter kernel. One action loops/branches/chains where a tool zoo needs many round-trips; plays to the LLM's strongest prior (writing code).
- Also: **event-stream as the single source of truth** (agent = pure function `history → next Action`; memory/microagents/delegation/stuck-detection are all services reading the same stream). Direct proof Forge's TurnEvent + DAG bet pays off at scale. Swappable sandboxed **Runtime** interface. **Microagents** (keyword-triggered context). Pattern-based **stuck detection**.
- **Don't copy**: the per-session Docker runtime + Action Execution Server + remote-provider matrix. Carve the Runtime *interface*, keep the only implementation a local process. And don't make CodeAct the *sole* action space without a sandbox — keep it an opt-in tool behind the runtime seam.

### Cursor CLI (cursor-agent) — *CI-grade headless ergonomics*
- **Signature**: the **`--output-format stream-json`** contract — in `-p` print mode it emits a typed line-delimited event stream to stdout (`system`/`assistant`/`tool_call`/`result`) so a CI script parses progress and outcome with `jq` instead of scraping prose. **This is the same shape as Forge's internal TurnEvent stream, serialized to stdout — it ports almost 1:1.**
- Also: **conditional file-scoped rules** (`.cursor/rules/*.mdc` with `globs`/`alwaysApply`/`description` frontmatter — only relevant rules load per turn, keeping the prompt lean; honors root `AGENTS.md`). Resumable/listable sessions. One `mcp.json` shared with the GUI.
- **Don't copy**: the server-side embedding index and the cloud-agent handoff. Lean on ripgrep/glob + on-demand reads (Forge already has these), MCP-provided index later if needed.

### Winning Terminal-Bench harnesses (meta) — *the middleware is the product*
- **Signature**: the **pre-completion verification gate** — a hook intercepts the agent as it tries to terminate and refuses the exit until it has run the task's own test command, read the failure, and self-corrected. Reported to move Terminal-Bench from **52.8% → 66.5%**. The single largest documented jump; zero extra model capability.
- Also: **escalating multi-tier compaction** (warn 70% → mask observations 80% → prune 85% → aggressive mask 90% → LLM summarize only at 99%; mask the bulky low-value tool *observations*, keep the plan/decisions). **Token-shaped tool outputs**. **Environment priming** (dir tree + tools + step budget injected before the first action, skipping 5–10 turns of `ls`/`find` churn). **Per-file soft loop counter** that *steers* ("reconsider your approach") rather than halts. **Reasoning sandwich** — high reasoning on plan + verify, low on mechanical edits; balanced **66.5% vs 53.9%** for xhigh-everywhere (more thinking, uniformly applied, was *worse*).
- **Don't copy**: the full five-tier LLM compaction stack and best-of-N/multi-sample machinery — both multiply cost, and recent results show heavy self-improving/search harnesses do **not** reliably beat simple ones. The 80/20 is *verification gate + masking compaction + bounded outputs*. And don't import a middleware framework to get them — land each technique in the seam Forge already has.

---

## Capability clusters mapped to Forge

Twelve recurring wins, each mapped to the Forge seam it plugs into.

| # | Cluster | Best exemplars | Forge status | Plugs into | Priority | Effort |
|---|---------|----------------|--------------|-----------|:---:|:---:|
| 1 | **Verification loop** (write → test → verify → fix before "done") | TB harnesses, Aider, OpenCode, Junie | missing | `runTurn` termination seam; reuses tool-dispatcher's error-ToolResult contract | **P0** | M |
| 2 | **Hierarchical steering memory** (`AGENTS.md`/`FORGE.md`) | Codex, Claude Code, Gemini, Cursor, Junie | missing | kernel context-assembly → `session-bridge`; `/memory` a CLI consumer | **P0** | S |
| 3 | **Context management** (masking compaction + bounded outputs) | TB harnesses, Codex, Claude Code | missing | `session-bridge` (log→Message[]) + ToolResult shape in tool contract | **P0** | M |
| 4 | **Headless/CI mode + stdout event stream** | Cursor, Droid, OpenHands | missing | pure CLI consumer over existing `TurnEvent` stream; new entry in `main.ts` | **P0** | S |
| 5 | **Autonomy dial + granular policies + read-only/plan mode** | Droid, Claude Code, OpenCode/Junie, Codex | partial | permission policy chain (`block` = 3rd un-bypassable guard); risk field on tool contract | P1 | M |
| 6 | **Genuine multi-model** (catalog, profiles, reasoning dial, Oracle, architect/editor) | Aider, Amp, OpenCode, Codex | partial | provider seam (`withThinking`/`withMaxTokens`), `build-provider.ts` | P1 | M |
| 7 | **Native multi-agent** (context-isolated subagents on the DAG) | Claude Code, Amp, Warp, OpenHands | missing | session DAG `parentId` + nested `runTurn` + permission chain (advisory vs worker) | P1 | L |
| 8 | **Session lifecycle** (resume, checkpoint/rewind, git-undo, export) | Gemini, Aider, Cursor/Codex, OpenCode/Amp | partial | JSONL DAG + snapshot ref on each `SessionEntry`; CLI subcommands | P1 | M |
| 9 | **Robust edit primitive** (context-anchored, per-model) | Codex `apply_patch`, Aider | partial | `edit_file` tool (pure contract) + per-model hint from `build-provider` | P1 | M |
| 10 | **Uniform plugin ecosystem** (progressive-disclosure skills, manifest, `.forge/mcp.json`, Forge-as-MCP) | Claude Code, Gemini, Cursor, Codex | partial | tool registry (dynamic import + MCP connect) + prompt-assembly seam | P1 | M |
| 11 | **Robustness guards** (richer loop detection + environment priming) | OpenHands, TB harnesses | partial | `doom-loop` unit (superset it) + first-orchestrator-step preamble | P1 | S |
| 12 | **Codebase intelligence** (LSP symbol tools + repo-map via plugin) | OpenCode, Junie, Aider | missing | LSP-diagnostics on ToolResult seam; symbol tools as pure tools; repo-map as a plugin | P2 | L |

---

## The build plan

Ordered so each phase rides seams the previous one established. Kernel-first; nothing here requires a redesign.

### Phase 0 — Foundations (cheap seams everything rides on)
*Close the embarrassing table-stakes gaps; make Forge steerable + scriptable. Every item is S-effort or a small contract change. Depends on: nothing.*
- Hierarchical `FORGE.md` / `AGENTS.md` steering loader (honor `AGENTS.md` for free interop with repos already steering Codex/Cursor).
- Bounded/structured tool outputs: `head+tail` + "…N lines elided" + structured error objects in the ToolResult contract (built-ins **and** MCP wrappers inherit it).
- **Untrusted data tainting & boundary tagging** in ToolResult outputs to protect the PermissionGate policy chain against prompt injection attacks when reading untrusted web or file content.
- Financial & token budget controls (`--max-budget $N`, `--max-tokens N`) enforced at `ModelProvider`/StepExecutor level to prevent runaway credit burn during unattended runs.
- Interactive intent-disambiguation primitive (`ask_question` modal) for clarifying ambiguous requirements cleanly rather than guessing or stalling.
- `forge exec` one-shot + `--output-format text|json|stream-json` serializing the existing `TurnEvent` stream; `--force` → existing `auto` mode. No kernel change.
- Read-only/plan permission mode + granular allow/deny/**block** policies (`block` as a third un-bypassable guard beside doom-loop and truncated-args).
- Environment preamble at session start (dir tree + git status + tool list + step budget) to kill discovery churn.
- Upgrade doom-loop to pattern detection (alternating cycles, repeated identical errors) + a per-file soft counter that *steers* rather than halts.

### Phase 1 — Long-session survival + verification (the score movers)
*The biggest documented quality jumps, all landing on existing seams. Depends on: Phase 0.*
- **Pre-completion verification gate** at the `runTurn` termination seam — block "done" until a declared/auto-detected test or `tsc --noEmit` passes; failures re-enter as error ToolResults. **Build this first — highest ROI in the study.**
- **Masking-based compaction** in `session-bridge` — above a token threshold, replace stale `tool_result` *bodies* with stubs, keep `tool_use` headers + text + latest N observations; the summary is a new `parentId` `SessionEntry` (non-destructive). Skip the five-tier LLM stack.
- **Automated self-eval CI regression suite**: leverage `forge exec --output-format stream-json` in CI to run synthetic benchmark tasks on every commit to measure pass rate vs token cost.
- Session resume/list: `forge sessions ls` + `forge resume <id>|--last|--continue` over the JSONL DAG.
- Git-native **checkpoint before every mutating tool** (snapshot ref on the `SessionEntry`, dirty-tree committed first) → `forge rewind`/`undo`; plus self-contained JSONL→HTML session export.

### Phase 2 — Genuine multi-model (differentiator a)
*Turn the provider seam from "single-model loop with a swappable backend" into real, measured multi-model. Depends on: Phase 1 (verification enables architect/editor + eval-select).*
- Reasoning-effort dial on `withThinking`/`withMaxTokens` + a **reasoning sandwich** (high on plan/verify, low on mechanical edits).
- Config profiles + `-c key=value` layered resolution (defaults < profile < CLI).
- External model **capability catalog** (context window / price / capability flags) feeding `build-provider`.
- **Cross-model Oracle** consult tool — nested `runTurn` on a *different* provider, read-only, returns a ToolResult.
- Architect/editor two-provider composition (two composed step-executors).
- Per-model edit-format capability + a small internal **eval harness** so defaults are measured, not guessed.

### Phase 3 — Native multi-agent orchestration (differentiator b)
*Context-isolated subagents as first-class children of the session DAG: fresh context in, distilled summary out. Depends on: Phase 1 + Phase 2.*
- `spawn_agent`/Task tool = nested `runTurn` rooted at the caller's `SessionEntry`, returning **only** a summary ToolResult (session-bridge coalesces the summary, never the subtree).
- **Subagent Worktree Merge Protocol**: subagent generates an atomic `git diff` patch; parent dry-runs `git apply` and runs Phase 1 verification on merged result before accepting.
- Advisory (read-only) vs worker (full-tool) children as a permission-policy distinction, not two codepaths.
- Parallel dispatch via tool-dispatcher batch execution.
- Per-child **git worktree isolation** (cwd threaded into the child's `ToolExecutionContext`).
- In-process message bus + explicit run-states surfaced as `TurnEvent`s — no server.
- **Best-of-N**: fork the DAG at a decision point, run N trajectories, keep the one whose verify command passes.

### Phase 4 — Third-party plugin ecosystem (differentiator c)
*One uniform, filesystem-discovered format — not five parallel plugin systems. Depends on: Phase 0 + existing registry.*
- Progressive-disclosure **skills-as-markdown** (name+description in context; `load_skill` pulls the body on demand).
- Auto-detected `.forge/mcp.json` convention (project + global).
- **MCP Sampling protocol** (`sampling/createMessage`): allow connected MCP servers to request LLM completions through Forge's `ModelProvider` seam.
- Extension **manifest** bundling tools + MCP + context + commands into one git-installable unit.
- Slash commands as CLI-side prompt templates (`$ARGUMENTS` / `` !`bash` `` / `@file`), expanded before the kernel sees them.
- Run **Forge as an MCP server** so one Forge is a callable sub-agent for another (also feeds b).

### Phase 5 — Deep local-dev intelligence (differentiator d, heaviest)
*Static ground truth + a runtime seam without a semantic index or an OS-sandbox matrix. Depends on: Phase 1 + Phase 4.*
- LSP client seam (start with TypeScript): diagnostics feed the Phase-1 verification loop as its first real payload.
- Read-only symbol tools (definition/references/hover/document_symbols) over one persistent LSP client.
- Repo-map shipped as an **optional** npm/MCP plugin — never kernel context-injection.
- Runtime/executor seam in `ToolExecutionContext` so bash/edit resolve against a pluggable executor (local process now, container/`sandbox-exec` later).
- Optional hooks as path-scoped permission policies + post-dispatch shell calls — deferred deliberately as a security-sensitive supply-chain surface.

---

## Strategy

### Forge's latent moats (build *on* these — competitors retrofit them)

Every competitor's best ideas were described as things that "drop cleanly onto an existing seam." Forge pre-built those seams:

- **The session DAG is the real structural advantage.** `parentId`, append-only, torn-line-tolerant, non-destructive. Competitors bolt rewind/checkpoint on afterward (Gemini's shadow-git, Aider's per-edit commits) because their logs are *lists*. Forge's is a *tree* from day one. Build on it what a list can't cheaply retrofit: checkpoint-per-node, sub-agent-as-branch (Amp's context hygiene falls out for free), non-destructive compaction (rewind to un-compacted truth), and best-of-N-with-verification (fork → N trajectories → keep the one whose tests pass).
- **The TurnEvent stream is a renderer-agnostic contract most CLIs lack.** Cursor's and Droid's headline headless feature (`stream-json`) is literally serializing what Forge already emits. It ports 1:1 and unlocks CI, an eval harness, and multiple consumers driving the identical kernel.
- **The headless-kernel axiom** ("CLI holds no privilege the kernel doesn't expose") is the OpenCode/OpenHands discipline adopted on day one instead of via a painful late refactor. `forge exec`, a `forge mcp` server, an HTTP adapter — all thin consumers.
- **The ordered permission policy chain is the cleanest consent model in the field.** Everything ports *into* it: plan mode, Droid's risk dial, allow/deny/block, PreToolUse hooks, Codex's escalate-on-failure — as one more policy, not bespoke code.
- **The provider abstraction** makes cross-model review nearly free: Amp's Oracle, Aider's architect/editor, the reasoning sandwich — compositions single-model CLIs structurally cannot do.

### Traps (lower-leverage than they look)
- **Native multi-agent orchestration** is the sexiest item and the *lowest-ROI right now*. The lift comes from single-agent verification/compaction; heavy multi-agent search does not reliably beat simple approaches. The real value of subagents is **context hygiene** — get 90% of it from *one* well-placed Task tool, not a Warp-style message-bus platform. Ship the isolation; defer the platform.
- **Repo-map / semantic index.** Every relevant `doNotCopy` flags this as a multi-year platform effort with cache-invalidation hell. LSP *diagnostics* (verification) massively outrank LSP *symbol retrieval* (indexing) in ROI. grep/glob + MCP cover the rest.
- **OS-level sandbox matrix.** Steal the model (autonomy behind an enforced boundary), wrap a container later.
- **The full extension zoo + hosted backends.** Pick one filesystem-discovered format; ship local session export instead of a hosted feed.
- **LLM multi-tier compaction and best-of-N** — both multiply token cost for unproven generalization. Masking captures most of the lift.

### Sequencing risks
- **Compaction before bounded outputs** → you compact noise you should never have admitted. Shape at source first.
- **Orchestration before verification + compaction** → parallelizing garbage; a subagent that can't verify its own work just produces confident-wrong summaries faster.
- **Rewind UI before snapshot storage** → you restore the conversation but leave the working tree wrong, which is worse than no rewind.
- **Plan mode / risk dial before verification** → a risk dial cranked to auto over an agent that never runs tests is just faster breakage.
- **Multi-model claims before an eval harness** → Aider's whole lesson is that per-model decisions must be *measured*. Ship `forge exec`/stream-json early, stand up a small apply-success eval on top, *then* claim "genuine multi-model."
- **Do-anytime**: `AGENTS.md` loading and bounded outputs block nothing and pay immediately — land them first.

### The wedge — the one thing to be best in the world at

The 4-differentiator bet is a **feature list, not a wedge**, and for a two-person team that's the core mistake. Being fourth-best at four things loses to someone who owns one. Graded honestly: (a) multi-model is real but commoditizing; (b) multi-agent is the trap; (c) plugins are chicken-and-egg (pay off *after* you've won); (d) deep-dev is vague-but-valuable (it's where verification and LSP diagnostics live).

The wedge Forge is *structurally* positioned to own isn't on the list:

> **Trustworthy autonomy through a reversible, verifiable session substrate.**
>
> Forge is the only CLI studied whose sessions are a native non-destructive DAG. Combine that with the verification gate, hard budget caps (`--max-budget`), untrusted data tainting, and the clean permission chain, and the story becomes: *the agent you can actually let run unattended — because every action is checkpointed and reversible, prompt injection is bounded, long runs survive via compaction that never destroys the ability to rewind to un-compacted truth, and it proves its own work before it stops.*

Codex chases autonomy-via-OS-sandbox (capital-intensive, wrong stack for Forge). Forge's cheaper, more portable answer is **autonomy-via-reversibility + verification + strict budget/taint boundaries** — running on seams competitors would have to re-architect to match. Lead with that; make multi-model *supporting* (cross-model verification literally strengthens the "verifiable" claim); demote (b) hard; defer (c) until there are users. The bet isn't wrong so much as **unfocused** — collapse four adequate differentiators into one Forge can be singular at.

---

## Do these first (ranked shortlist)

1. **Pre-completion verification gate.** Biggest documented score jump (52.8% → 66.5%), zero extra model capability, drops onto the `runTurn` termination seam. Test/`tsc --noEmit` version before any LSP.
2. **Hierarchical `FORGE.md`/`AGENTS.md` steering.** S-effort, cheapest durable lever; honoring `AGENTS.md` gives free interop with Codex/Cursor repos.
3. **`forge exec` + `--output-format stream-json`.** Highest leverage per line — the event stream already exists. Becomes the substrate every future CI job and multi-agent parent drives.
4. **Bounded/structured tool outputs.** One S-effort ToolResult change; precondition for cheap compaction; every MCP tool inherits it.
5. **Masking-based compaction in `session-bridge`.** Without it Forge dies at ~200k tokens; with it long runs survive *and stay rewindable*.
6. **Read-only/plan mode + block/deny/allow policies.** Makes accept-edits/auto genuinely usable; pure additions to the permission chain.
7. **Session resume + git checkpoint/rewind.** Turns the DAG bet from "structurally enabled" into shipped fork/rewind/undo. Resume is mostly plumbing over storage you already own.
8. **Cross-model Oracle consult tool.** Cheapest *real* multi-model quality lever; near-free given the provider seam. Smallest first proof of differentiator (a).
9. **Sequence the headline differentiators (b, c) after the cheap wins** — they compound on verification + checkpoint + resume + the headless stream. Steal *models*, not implementations.

---

## Appendix — leaderboard snapshot (as of 2026-07-23)

**Terminal-Bench 2.0** (top 10): NexAU-AHE (GPT-5.5) 84.7 · LemonHarness 84.5 · Capy 83.1 · **Codex CLI** 82.2 · Polaris 82.2 · WOZCODE (Opus 4.7) 80.2 · TongAgents (Gemini 3.1 Pro) 80.2 · LemonHarness 79.9 · SageAgent 78.4 · **Droid** (Factory) 77.3. *142 entries total.*

**SanityHarness** (top 5, weighted score): **Codex CLI** / GPT-5.5 — 26.39 · **Junie** / Opus 4.7 — 26.35 · **Junie** / Opus 4.6 — 25.05 · **Codex CLI** / GPT-5.4 — 24.73 · **OpenCode** / Opus 4.6 — 23.75. *26 agent-model combos across 37 evals, 6 languages.*

Most of the very top Terminal-Bench slots are private research harnesses running frontier models — which is itself the point: **the harness is doing the work.**
