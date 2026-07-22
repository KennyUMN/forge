# Sprint 4: CLI Wiring + Integration Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal terminal CLI (`forge`) that drives the kernel interactively, proving the library/CLI boundary holds in practice -- session resume, streamed output, real terminal permission prompts, and a real MCP server wired in alongside the built-in tools.

**Architecture:** Small, independently-testable CLI modules (config loading, terminal ask, session resolution, tool-registry construction) compose into a thin `main()` entrypoint. Two prior-sprint files get small, additive, backward-compatible extensions: the Step Executor gains an optional streaming callback, and the MCP client namespaces a connected server's tool names (`<serverName>__<toolName>`) when loading them into a shared registry, so they never collide with the built-in tools' plain names (the official filesystem MCP server exposes `read_file`/`write_file`, which would otherwise collide -- this is the decision flagged as carried over from Sprint 3).

**Tech Stack:** TypeScript (Node >=20, ESM/NodeNext), Vitest, `node:readline/promises` (built-in, no new dependency) for the terminal prompt.

## Global Constraints

- Node >=20, TypeScript with `strict: true`.
- No new runtime dependencies -- `node:readline/promises` is a Node builtin.
- Modifications to Sprint 2/3 files (`step-executor.ts`, `turn-orchestrator.ts`, `mcp-client.ts`) must be strictly additive and backward-compatible: every existing call site and test continues to work unchanged, with exactly one documented exception (two assertions in `test/mcp/mcp-client.test.ts` that must change because tool names are now namespaced -- called out explicitly in Task 2).
- CLI session storage lives at `.forge/sessions/` under the current working directory (`.forge/` is already gitignored).
- `bin/forge.js` stays plain JavaScript (not compiled) -- it only imports the already-compiled `dist/cli/main.js` and needs no TypeScript features itself.
- No placeholder/TODO code -- every function does what its tests assert.
- Commit after every task's tests pass.

## Real Sprint 1-3 Interfaces This Sprint Builds On

```ts
// src/session/session-store.ts
export class SessionStore {
  readonly sessionId: string;
  static create(sessionsDir: string): Promise<SessionStore>;
  static load(sessionsDir: string, sessionId: string): Promise<SessionStore>;
  getEntries(): readonly SessionEntry[];
}

// src/provider/anthropic-provider.ts
export interface AnthropicProviderOptions { apiKey: string; model: string; maxTokens?: number; thinkingEffort?: ThinkingEffort; }
export class AnthropicProvider implements ModelProvider { constructor(options: AnthropicProviderOptions, client?: Anthropic); }

// src/permission/permission-gate.ts
export class PermissionGate { constructor(policies: PermissionPolicy[], ask: (call: ToolCallRequest) => Promise<boolean>); }
// src/permission/permission-policies.ts
export const DEFAULT_PERMISSION_POLICIES: PermissionPolicy[]; // [autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy]

// src/agent/turn-orchestrator.ts
export interface TurnOrchestratorOptions { provider, session, tools: ReadonlyMap<string, Tool>, gate, systemPrompt, toolContext, maxSteps? }
export function runTurn(userText: string, options: TurnOrchestratorOptions): Promise<TurnResult>;

// src/tool/tool-registry.ts
export class ToolRegistry { registerTool(tool: Tool): void; getTool(name): Tool | undefined; getAll(): ReadonlyMap<string, Tool>; }

// src/mcp/mcp-client.ts
export interface McpServerConfig { name: string; command: string; args?: string[]; }
export function loadMcpServerIntoRegistry(registry: ToolRegistry, config: McpServerConfig): Promise<{ close(): Promise<void> }>;

// src/tools/*.ts -- six built-in Tool instances:
export const readFileTool, writeFileTool, editFileTool, bashTool, grepTool, globTool; // names: read_file, write_file, edit_file, bash, grep, glob
```

---

### Task 1: Terminal permission prompt + CLI config loading

**Files:**
- Create: `src/cli/ask-terminal.ts`
- Create: `src/cli/config.ts`
- Test: `test/cli/ask-terminal.test.ts`
- Test: `test/cli/config.test.ts`

**Interfaces:**
- Consumes: `ToolCallRequest` (Sprint 2, `src/types/tool-call.js`); `McpServerConfig` (Sprint 3, `src/mcp/mcp-client.js`).
- Produces: `askTerminal(call): Promise<boolean>`, `parseYesNo(input): boolean`, `formatAskPrompt(call): string` (`src/cli/ask-terminal.ts`); `loadConfig(cwd): Promise<ForgeConfig>`, `ForgeConfig { mcpServers: McpServerConfig[] }`, `requireApiKey(): string` (`src/cli/config.ts`) -- Task 3's CLI `main()` calls all of these directly.

- [ ] **Step 1: Write the failing tests**

Create `test/cli/ask-terminal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseYesNo, formatAskPrompt } from "../../src/cli/ask-terminal.js";

describe("parseYesNo", () => {
  it("returns true for 'y'", () => {
    expect(parseYesNo("y")).toBe(true);
  });

  it("returns true for 'yes' case-insensitively", () => {
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("YES")).toBe(true);
  });

  it("returns false for 'n'", () => {
    expect(parseYesNo("n")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(parseYesNo("")).toBe(false);
  });

  it("returns false for anything else", () => {
    expect(parseYesNo("sure")).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(parseYesNo("  y  ")).toBe(true);
  });
});

describe("formatAskPrompt", () => {
  it("includes the tool name and JSON-stringified input", () => {
    const prompt = formatAskPrompt({ id: "1", name: "bash", input: { command: "ls" } });
    expect(prompt).toContain("bash");
    expect(prompt).toContain('{"command":"ls"}');
  });
});
```

Create `test/cli/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, requireApiKey } from "../../src/cli/config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-cli-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns an empty mcpServers list when no config file exists", async () => {
    const config = await loadConfig(dir);
    expect(config).toEqual({ mcpServers: [] });
  });

  it("reads mcpServers from forge.config.json when present", async () => {
    await writeFile(
      join(dir, "forge.config.json"),
      JSON.stringify({
        mcpServers: [{ name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }],
      }),
      "utf8",
    );

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([
      { name: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    ]);
  });

  it("defaults mcpServers to an empty array if the config file omits it", async () => {
    await writeFile(join(dir, "forge.config.json"), JSON.stringify({}), "utf8");

    const config = await loadConfig(dir);

    expect(config.mcpServers).toEqual([]);
  });
});

describe("requireApiKey", () => {
  it("returns the API key when ANTHROPIC_API_KEY is set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      expect(requireApiKey()).toBe("test-key");
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("throws a clear error when ANTHROPIC_API_KEY is not set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => requireApiKey()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/cli/ask-terminal.test.ts test/cli/config.test.ts`
Expected: FAIL -- modules not found

- [ ] **Step 3: Implement the terminal ask function**

Create `src/cli/ask-terminal.ts`:

```ts
import { createInterface } from "node:readline/promises";
import type { ToolCallRequest } from "../types/tool-call.js";

export function parseYesNo(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export function formatAskPrompt(call: ToolCallRequest): string {
  return `Allow tool call "${call.name}" with input ${JSON.stringify(call.input)}? [y/N] `;
}

export async function askTerminal(call: ToolCallRequest): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(formatAskPrompt(call));
    return parseYesNo(answer);
  } finally {
    rl.close();
  }
}
```

- [ ] **Step 4: Implement CLI config loading**

Create `src/cli/config.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "../mcp/mcp-client.js";

export interface ForgeConfig {
  mcpServers: McpServerConfig[];
}

const CONFIG_FILENAME = "forge.config.json";

export async function loadConfig(cwd: string): Promise<ForgeConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: [] };
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Partial<ForgeConfig>;
  return { mcpServers: parsed.mcpServers ?? [] };
}

export function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set.");
  }
  return apiKey;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/cli/ask-terminal.test.ts test/cli/config.test.ts`
Expected: PASS (7 + 5 = 12 tests)

- [ ] **Step 6: Commit**

```bash
git add src/cli/ask-terminal.ts src/cli/config.ts test/cli/ask-terminal.test.ts test/cli/config.test.ts
git commit -m "feat: add terminal permission prompt and CLI config loading"
```

---

### Task 2: MCP tool namespacing + registry builder

**Files:**
- Modify: `src/mcp/mcp-client.ts` (add a `namespaceTool` helper; use it in `loadMcpServerIntoRegistry`)
- Modify: `test/mcp/mcp-client.test.ts` (two existing tests updated to expect namespaced names -- one gains an added assertion proving the raw, non-namespaced name is NOT registered)
- Create: `src/cli/build-registry.ts`
- Test: `test/cli/build-registry.test.ts`

**Interfaces:**
- Consumes: `Tool` (Sprint 2, `src/tool/tool.js`); `ToolRegistry` (Sprint 3, `src/tool/tool-registry.js`); `McpServerConfig`, `loadMcpServerIntoRegistry` (Sprint 3, `src/mcp/mcp-client.js`); the six built-in tools (Sprint 3, `src/tools/*.js`).
- Produces: `buildToolRegistry(mcpServers): Promise<RegistryHandle>`, `RegistryHandle { registry, close() }` (`src/cli/build-registry.ts`) -- Task 3's CLI `main()` is the only caller.

**Why this task modifies Sprint 3's file**: Sprint 3's `loadMcpServerIntoRegistry` registers each MCP tool under its raw name. The official filesystem MCP reference server (used in Sprint 3's own manual smoke test, and a realistic first real-world config here) exposes tools named `read_file`/`write_file`, which collide by name with Forge's own built-ins. This task namespaces every tool loaded through `loadMcpServerIntoRegistry` as `<serverName>__<toolName>`, so collisions with built-ins (or with a second MCP server) can't happen by construction. `connectMcpServer` itself is unchanged -- it's a lower-level primitive that returns a server's tools under their raw MCP names; only the registry-populating helper adds the prefix.

- [ ] **Step 1: Update the existing MCP client test for namespacing, and add a new test**

In `test/mcp/mcp-client.test.ts`, find this test inside the `describe("loadMcpServerIntoRegistry", ...)` block:

```ts
  it("registers every tool from a connected MCP server into the given registry", async () => {
    const registry = new ToolRegistry();

    const connection = await loadMcpServerIntoRegistry(registry, {
      name: "fixture",
      command: "node",
      args: [fixtureServerPath],
    });
    cleanup = connection.close;

    const tool = registry.getTool("fixture_echo");
    expect(tool).toBeDefined();
    const result = await tool!.execute({ text: "hi" }, { cwd: "/tmp" });
    expect(result).toEqual({ output: "echo: hi", isError: false });
  });
```

Replace it with (the tool is now registered under the namespaced name -- and add a second assertion proving the raw, non-namespaced name was NOT used):

```ts
  it("registers every tool from a connected MCP server into the given registry, namespaced by server name", async () => {
    const registry = new ToolRegistry();

    const connection = await loadMcpServerIntoRegistry(registry, {
      name: "fixture",
      command: "node",
      args: [fixtureServerPath],
    });
    cleanup = connection.close;

    expect(registry.getTool("fixture_echo")).toBeUndefined();
    const tool = registry.getTool("fixture__fixture_echo");
    expect(tool).toBeDefined();
    const result = await tool!.execute({ text: "hi" }, { cwd: "/tmp" });
    expect(result).toEqual({ output: "echo: hi", isError: false });
  });
```

Then find this test (also inside `describe("loadMcpServerIntoRegistry", ...)`):

```ts
  it("closes the connection instead of leaking the subprocess when a tool name collision throws during registration", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "fixture_echo",
      description: "pre-existing tool with a colliding name",
      parameters: {},
      async execute() {
        return { output: "pre-existing", isError: false };
      },
    });
```

Change the pre-registered tool's `name` so it actually collides with the now-namespaced tool the fixture server will register (`fixture__fixture_echo`, not the raw `fixture_echo`):

```ts
  it("closes the connection instead of leaking the subprocess when a tool name collision throws during registration", async () => {
    const registry = new ToolRegistry();
    registry.registerTool({
      name: "fixture__fixture_echo",
      description: "pre-existing tool with a colliding namespaced name",
      parameters: {},
      async execute() {
        return { output: "pre-existing", isError: false };
      },
    });
```

The rest of that test (the `loadMcpServerIntoRegistry` call, the `rejects.toThrow(/already registered/)` assertion, and the `closeSpy` assertion) stays exactly as it is -- only the pre-registered tool's `name` field changes.

- [ ] **Step 2: Run the MCP client tests to verify the updated ones fail against the current (pre-namespacing) code**

Run: `npm test -- test/mcp/mcp-client.test.ts`
Expected: FAIL -- the two updated tests now fail because tools are still registered under their raw (non-namespaced) names.

- [ ] **Step 3: Add namespacing to the MCP client**

In `src/mcp/mcp-client.ts`, find this function:

```ts
export async function loadMcpServerIntoRegistry(
  registry: ToolRegistry,
  config: McpServerConfig,
): Promise<{ close(): Promise<void> }> {
  const connection = await connectMcpServer(config);
  try {
    for (const tool of connection.tools) {
      registry.registerTool(tool);
    }
  } catch (err) {
```

Add a `namespaceTool` helper above it, and use it inside the loop:

```ts
// Prefixes a tool's name with its server name (e.g. "fs__read_file") so
// tools loaded from different MCP servers -- or from an MCP server whose
// tool happens to share a name with one of Forge's own built-ins, like the
// official filesystem server's read_file/write_file -- can never collide in
// a shared ToolRegistry. The tool's own execute() still calls the MCP server
// using its original, non-namespaced name (that name is closed over inside
// toForgeTool), so behavior is unaffected -- only the registry key changes.
function namespaceTool(tool: Tool, serverName: string): Tool {
  return { ...tool, name: `${serverName}__${tool.name}` };
}

export async function loadMcpServerIntoRegistry(
  registry: ToolRegistry,
  config: McpServerConfig,
): Promise<{ close(): Promise<void> }> {
  const connection = await connectMcpServer(config);
  try {
    for (const tool of connection.tools) {
      registry.registerTool(namespaceTool(tool, config.name));
    }
  } catch (err) {
```

The rest of the function (the `catch` block that closes the connection before re-throwing, and the final `return { close: connection.close }`) stays exactly as it is.

- [ ] **Step 4: Run the MCP client tests to verify they pass**

Run: `npm test -- test/mcp/mcp-client.test.ts`
Expected: PASS (6 tests total in the file -- 4 in `connectMcpServer` unchanged, 2 in `loadMcpServerIntoRegistry`, both edited in place to expect namespaced names)

- [ ] **Step 5: Write the failing test for the registry builder**

Create `test/cli/build-registry.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildToolRegistry } from "../../src/cli/build-registry.js";

const fixtureServerPath = fileURLToPath(new URL("../fixtures/mcp-fixture-server.js", import.meta.url));

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
});

describe("buildToolRegistry", () => {
  it("registers all six built-in tools when no MCP servers are configured", async () => {
    const handle = await buildToolRegistry([]);
    cleanup = handle.close;

    const names = [...handle.registry.getAll().keys()].sort();
    expect(names).toEqual(["bash", "edit_file", "glob", "grep", "read_file", "write_file"]);
  });

  it("also registers a configured MCP server's tools, namespaced by server name", async () => {
    const handle = await buildToolRegistry([{ name: "fixture", command: "node", args: [fixtureServerPath] }]);
    cleanup = handle.close;

    expect(handle.registry.getTool("fixture__fixture_echo")).toBeDefined();
    expect(handle.registry.getTool("read_file")).toBeDefined();
  });

  it("close() shuts down every MCP connection that was opened", async () => {
    const handle = await buildToolRegistry([{ name: "fixture", command: "node", args: [fixtureServerPath] }]);

    await expect(handle.close()).resolves.not.toThrow();
    cleanup = undefined;
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- test/cli/build-registry.test.ts`
Expected: FAIL -- `Cannot find module '../../src/cli/build-registry.js'`

- [ ] **Step 7: Implement the registry builder**

Create `src/cli/build-registry.ts`:

```ts
import { ToolRegistry } from "../tool/tool-registry.js";
import { loadMcpServerIntoRegistry } from "../mcp/mcp-client.js";
import type { McpServerConfig } from "../mcp/mcp-client.js";
import { readFileTool } from "../tools/read-file.js";
import { writeFileTool } from "../tools/write-file.js";
import { editFileTool } from "../tools/edit-file.js";
import { bashTool } from "../tools/bash.js";
import { grepTool } from "../tools/grep.js";
import { globTool } from "../tools/glob.js";

const BUILTIN_TOOLS = [readFileTool, writeFileTool, editFileTool, bashTool, grepTool, globTool];

export interface RegistryHandle {
  registry: ToolRegistry;
  close(): Promise<void>;
}

// Builds one ToolRegistry containing every built-in tool plus every
// configured MCP server's tools (namespaced by loadMcpServerIntoRegistry to
// avoid name collisions). Returns a single close() that shuts down every MCP
// connection opened along the way.
export async function buildToolRegistry(mcpServers: McpServerConfig[]): Promise<RegistryHandle> {
  const registry = new ToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.registerTool(tool);
  }

  const closers: Array<() => Promise<void>> = [];
  for (const config of mcpServers) {
    const connection = await loadMcpServerIntoRegistry(registry, config);
    closers.push(connection.close);
  }

  return {
    registry,
    close: async () => {
      for (const close of closers) {
        await close();
      }
    },
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- test/cli/build-registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add src/mcp/mcp-client.ts test/mcp/mcp-client.test.ts src/cli/build-registry.ts test/cli/build-registry.test.ts
git commit -m "feat: namespace MCP tool names to avoid collisions and add a registry builder"
```

---

### Task 3: Streaming hook + CLI entrypoint

**Files:**
- Modify: `src/agent/step-executor.ts` (add an optional `StepCallbacks` parameter)
- Modify: `src/agent/turn-orchestrator.ts` (add an optional `onTextDelta` option, threaded through to `executeStep`)
- Create: `src/cli/resolve-session.ts`
- Create: `src/cli/main.ts`
- Create: `bin/forge.js`
- Modify: `package.json` (add a `"bin"` field)
- Test: `test/cli/resolve-session.test.ts`

**Interfaces:**
- Consumes: `AnthropicProvider` (Sprint 1); `PermissionGate`, `DEFAULT_PERMISSION_POLICIES` (Sprint 2); `runTurn` (Sprint 2, now with an added `onTextDelta` option); `SessionStore` (Sprint 1); `buildToolRegistry` (Task 2); `loadConfig`, `requireApiKey` (Task 1); `askTerminal` (Task 1).
- Produces: `StepCallbacks { onTextDelta? }` (`src/agent/step-executor.ts`); `parseArgs(argv): ParsedArgs`, `resolveSession(sessionsDir, args): Promise<SessionStore>` (`src/cli/resolve-session.ts`); `main(argv): Promise<void>` (`src/cli/main.ts`) -- Task 4's integration test calls `resolveSession`/`buildToolRegistry` directly; `bin/forge.js` is the sole caller of `main()`.

- [ ] **Step 1: Add the streaming callback to the Step Executor**

In `src/agent/step-executor.ts`, replace the whole file with:

```ts
import type { ModelProvider, StreamContext } from "../provider/model-provider.js";
import type { FinishReason } from "../types/message.js";
import type { ToolCallRequest } from "../types/tool-call.js";

export interface StepResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: FinishReason;
}

export interface StepCallbacks {
  onTextDelta?: (text: string) => void;
}

// Runs exactly one model round-trip: streams the provider's response and
// accumulates it into a single result. Does not dispatch tool calls or touch
// the session log -- that's the Tool Dispatcher's and Turn Orchestrator's
// job, kept separate so each unit is independently testable. The optional
// onTextDelta callback lets a caller (e.g. the CLI) render text as it
// streams in, without changing what this function returns.
export async function executeStep(
  provider: ModelProvider,
  context: StreamContext,
  callbacks: StepCallbacks = {},
): Promise<StepResult> {
  let text = "";
  const toolCalls: ToolCallRequest[] = [];
  let finishReason: FinishReason = "other";

  for await (const event of provider.stream(context)) {
    if (event.type === "text_delta") {
      text += event.text;
      callbacks.onTextDelta?.(event.text);
    } else if (event.type === "tool_call") {
      toolCalls.push({ id: event.id, name: event.name, input: event.input });
    } else if (event.type === "finish") {
      finishReason = event.reason;
    }
    // thinking_delta is intentionally ignored -- not part of Sprint 2's contract.
  }

  return { text, toolCalls, finishReason };
}
```

This is the only change: a new optional third parameter, defaulting to `{}`, invoked only on `text_delta` events. Every existing 2-argument call site (in `turn-orchestrator.ts` before this task's next step, and in `test/agent/step-executor.test.ts`) keeps working unchanged.

- [ ] **Step 2: Run the existing Step Executor tests to confirm nothing broke**

Run: `npm test -- test/agent/step-executor.test.ts`
Expected: PASS (4 tests, unchanged)

- [ ] **Step 3: Thread the callback through the Turn Orchestrator**

In `src/agent/turn-orchestrator.ts`, find:

```ts
export interface TurnOrchestratorOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  gate: PermissionGate;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  maxSteps?: number;
}
```

Add the new optional field:

```ts
export interface TurnOrchestratorOptions {
  provider: ModelProvider;
  session: SessionStore;
  tools: ReadonlyMap<string, Tool>;
  gate: PermissionGate;
  systemPrompt: string;
  toolContext: ToolExecutionContext;
  maxSteps?: number;
  onTextDelta?: (text: string) => void;
}
```

Then find:

```ts
export async function runTurn(userText: string, options: TurnOrchestratorOptions): Promise<TurnResult> {
  const { provider, session, tools, gate, systemPrompt, toolContext } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolSchemas = toolsToSchemas(tools);

  await session.append("user_message", { text: userText });

  let callHistory: ToolCallRequest[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const messages = sessionEntriesToMessages(session.getEntries());
    const stepResult = await executeStep(provider, { systemPrompt, messages, tools: toolSchemas });
```

Replace with (destructure `onTextDelta` and pass it through as a `StepCallbacks` object):

```ts
export async function runTurn(userText: string, options: TurnOrchestratorOptions): Promise<TurnResult> {
  const { provider, session, tools, gate, systemPrompt, toolContext, onTextDelta } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolSchemas = toolsToSchemas(tools);

  await session.append("user_message", { text: userText });

  let callHistory: ToolCallRequest[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const messages = sessionEntriesToMessages(session.getEntries());
    const stepResult = await executeStep(provider, { systemPrompt, messages, tools: toolSchemas }, { onTextDelta });
```

Everything after this line in the function is unchanged.

- [ ] **Step 4: Run the existing Turn Orchestrator tests to confirm nothing broke**

Run: `npm test -- test/agent/turn-orchestrator.test.ts`
Expected: PASS (5 tests, unchanged -- none of them pass `onTextDelta`, so this is a no-op for them)

- [ ] **Step 5: Write the failing tests for session resolution**

Create `test/cli/resolve-session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, resolveSession } from "../../src/cli/resolve-session.js";
import { SessionStore } from "../../src/session/session-store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-resolve-session-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("returns no resumeSessionId when --resume is absent", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("returns resumeSessionId when --resume <id> is given", () => {
    expect(parseArgs(["--resume", "abc-123"])).toEqual({ resumeSessionId: "abc-123" });
  });

  it("ignores a trailing --resume with no id", () => {
    expect(parseArgs(["--resume"])).toEqual({});
  });
});

describe("resolveSession", () => {
  it("creates a new session when no resumeSessionId is given", async () => {
    const session = await resolveSession(dir, {});
    expect(session.sessionId).toBeTruthy();
    expect(session.getEntries()).toEqual([]);
  });

  it("resumes an existing session by id, preserving its history", async () => {
    const original = await SessionStore.create(dir);
    await original.append("user_message", { text: "hello" });

    const resumed = await resolveSession(dir, { resumeSessionId: original.sessionId });

    expect(resumed.getEntries()).toEqual(original.getEntries());
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- test/cli/resolve-session.test.ts`
Expected: FAIL -- `Cannot find module '../../src/cli/resolve-session.js'`

- [ ] **Step 7: Implement session resolution**

Create `src/cli/resolve-session.ts`:

```ts
import { SessionStore } from "../session/session-store.js";

export interface ParsedArgs {
  resumeSessionId?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const resumeIndex = argv.indexOf("--resume");
  if (resumeIndex !== -1 && argv[resumeIndex + 1]) {
    return { resumeSessionId: argv[resumeIndex + 1] };
  }
  return {};
}

export async function resolveSession(sessionsDir: string, args: ParsedArgs): Promise<SessionStore> {
  if (args.resumeSessionId) {
    return SessionStore.load(sessionsDir, args.resumeSessionId);
  }
  return SessionStore.create(sessionsDir);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- test/cli/resolve-session.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Implement the CLI entrypoint**

Create `src/cli/main.ts`:

```ts
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { AnthropicProvider } from "../provider/anthropic-provider.js";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildToolRegistry } from "./build-registry.js";
import { loadConfig, requireApiKey } from "./config.js";
import { askTerminal } from "./ask-terminal.js";
import { parseArgs, resolveSession } from "./resolve-session.js";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export async function main(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  const args = parseArgs(argv);
  const config = await loadConfig(cwd);
  const apiKey = requireApiKey();

  const sessionsDir = join(cwd, ".forge", "sessions");
  const session = await resolveSession(sessionsDir, args);
  console.log(`Session: ${session.sessionId}`);

  const registryHandle = await buildToolRegistry(config.mcpServers);
  const provider = new AnthropicProvider({ apiKey, model: DEFAULT_MODEL });
  const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, askTerminal);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const userText = await rl.question("> ");
      const trimmed = userText.trim();
      if (trimmed.length === 0) continue;
      if (trimmed === "/exit") break;

      const result = await runTurn(userText, {
        provider,
        session,
        tools: registryHandle.registry.getAll(),
        gate,
        systemPrompt: "You are Forge, an agentic coding assistant.",
        toolContext: { cwd },
        onTextDelta: (text) => process.stdout.write(text),
      });

      process.stdout.write("\n");
      if (result.stoppedReason === "max_steps_reached") {
        console.log("(stopped: max steps reached)");
      }
    }
  } finally {
    rl.close();
    await registryHandle.close();
  }
}
```

- [ ] **Step 10: Create the bin entrypoint**

Create `bin/forge.js`:

```js
#!/usr/bin/env node
import { main } from "../dist/cli/main.js";

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

Make it executable:

```bash
chmod +x bin/forge.js
```

- [ ] **Step 11: Add the bin field to package.json**

In `package.json`, add a `"bin"` field (after `"version"` or anywhere at the top level -- exact position doesn't matter):

```json
  "bin": {
    "forge": "./bin/forge.js"
  },
```

- [ ] **Step 12: Build and sanity-check the CLI starts and exits cleanly**

Run: `npm run build && ANTHROPIC_API_KEY=sk-placeholder node bin/forge.js <<< "/exit"`
Expected: prints a line starting with `Session: `, then exits with code 0 (no hang, no stack trace). This does not make a real API call (the user immediately types `/exit`), so a placeholder API key is fine here -- it only proves the process wires up, starts, and shuts down (including closing the tool registry) without an unhandled error.

- [ ] **Step 13: Commit**

```bash
git add src/agent/step-executor.ts src/agent/turn-orchestrator.ts src/cli/resolve-session.ts src/cli/main.ts bin/forge.js package.json test/cli/resolve-session.test.ts
git commit -m "feat: add streaming callback and the forge CLI entrypoint"
```

---

### Task 4: End-to-end integration test + self-hosting smoke test

**Files:**
- Test: `test/integration/cli-full-loop.test.ts`

**Interfaces:**
- Consumes: `buildToolRegistry` (Task 2); `resolveSession` (Task 3); `PermissionGate`, `DEFAULT_PERMISSION_POLICIES` (Sprint 2); `runTurn` (Sprint 2/Task 3); `ModelProvider`, `StreamContext`, `StreamEvent` (Sprint 1).
- Produces: nothing new -- this is a pure integration test, mirroring Sprint 3 Task 5's pattern but exercising the CLI's own construction functions (`buildToolRegistry`, `resolveSession`) instead of hand-assembling pieces directly.

- [ ] **Step 1: Write the integration test**

Create `test/integration/cli-full-loop.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToolRegistry } from "../../src/cli/build-registry.js";
import { resolveSession } from "../../src/cli/resolve-session.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../../src/permission/permission-policies.js";
import { runTurn } from "../../src/agent/turn-orchestrator.js";
import type { ModelProvider, StreamContext } from "../../src/provider/model-provider.js";
import type { StreamEvent } from "../../src/types/message.js";

class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  private callCount = 0;

  constructor(private readonly script: StreamEvent[][]) {}

  async *stream(_context: StreamContext): AsyncIterable<StreamEvent> {
    const batch = this.script[Math.min(this.callCount, this.script.length - 1)];
    this.callCount++;
    for (const event of batch) yield event;
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forge-cli-loop-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("CLI wiring end-to-end (fake model, real everything else)", () => {
  it("resolves a session, builds the registry, and writes a real file through the CLI's own construction functions", async () => {
    const registryHandle = await buildToolRegistry([]);
    const session = await resolveSession(join(dir, ".forge", "sessions"), {});
    const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => true);

    const streamed: string[] = [];
    const provider = new ScriptedProvider([
      [
        { type: "tool_call", id: "1", name: "write_file", input: { path: "hello.txt", content: "hi from forge" } },
        { type: "finish", reason: "tool_calls", rawReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Wrote hello.txt" },
        { type: "finish", reason: "completed", rawReason: "end_turn" },
      ],
    ]);

    const result = await runTurn("create hello.txt", {
      provider,
      session,
      tools: registryHandle.registry.getAll(),
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
      onTextDelta: (text) => streamed.push(text),
    });

    expect(result.stoppedReason).toBe("completed");
    expect(streamed.join("")).toBe("Wrote hello.txt");
    expect(await fsReadFile(join(dir, "hello.txt"), "utf8")).toBe("hi from forge");

    await registryHandle.close();
  });

  it("resuming a session by id continues the same conversation history", async () => {
    const sessionsDir = join(dir, ".forge", "sessions");
    const registryHandle = await buildToolRegistry([]);
    const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => true);

    const first = await resolveSession(sessionsDir, {});
    const providerOne = new ScriptedProvider([
      [{ type: "text_delta", text: "first reply" }, { type: "finish", reason: "completed", rawReason: "end_turn" }],
    ]);
    await runTurn("first message", {
      provider: providerOne,
      session: first,
      tools: registryHandle.registry.getAll(),
      gate,
      systemPrompt: "",
      toolContext: { cwd: dir },
    });

    const resumed = await resolveSession(sessionsDir, { resumeSessionId: first.sessionId });
    expect(resumed.getEntries()).toHaveLength(2); // user_message + assistant_message
    expect(resumed.getEntries()[0].payload).toEqual({ text: "first message" });

    await registryHandle.close();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- test/integration/cli-full-loop.test.ts`
Expected: PASS (2 tests). If it fails, the failure points at an integration seam between the CLI construction functions (Tasks 2-3) and Sprint 2's `runTurn` -- not at new code in this task, since there is none.

- [ ] **Step 3: Run the full test suite and both typecheck paths**

Run: `npm test && npm run typecheck && npm run typecheck:test`
Expected: all tests pass. Sprints 1-3 total 112 tests (unchanged in count -- two tests in `mcp-client.test.ts` were edited in place for namespacing, not added). Sprint 4 adds 22 new tests: Task 1 = 12 (`ask-terminal.test.ts` 7 + `config.test.ts` 5), Task 2 = 3 (`build-registry.test.ts`; `mcp-client.test.ts` stays at 6), Task 3 = 5 (`resolve-session.test.ts`; `step-executor.test.ts`/`turn-orchestrator.test.ts` stay at 4/5), Task 4 = 2 (`cli-full-loop.test.ts`). Total: 112 + 22 = **134 tests**, both typechecks report no errors.

- [ ] **Step 4: Commit**

```bash
git add test/integration/cli-full-loop.test.ts
git commit -m "test: verify the CLI's construction functions work end-to-end with runTurn"
```

- [ ] **Step 5 (manual, gated on a real Anthropic API key + network access): the self-hosting smoke test**

Not an automated test -- this is the PRD's literal "Forge can be pointed at its own repo and make a real one-line change" requirement, which needs a real model call and is therefore manual, same pattern as Sprint 1's Task 4 Step 7 and Sprint 3's Task 4 Step 6.

```bash
cd ~/Projects/Forge
npm run build
ANTHROPIC_API_KEY=sk-... node bin/forge.js
```

At the `>` prompt, type a small, real, verifiable request against Forge's own source, for example:

```
Add a one-line comment above the DEFAULT_MAX_STEPS constant in src/agent/turn-orchestrator.ts explaining what it's for. Read the file first, then make the edit.
```

Approve the `read_file` (auto-allowed) and `edit_file`/`write_file` (asks -- type `y`) calls as they come up. Then, in a separate terminal:

```bash
git diff src/agent/turn-orchestrator.ts
```

Expected: a real, sensible one-line comment was added exactly where asked. Then either `git checkout -- src/agent/turn-orchestrator.ts` to discard the smoke-test edit, or commit it if it's genuinely a good comment worth keeping -- your call at that point, not part of this plan.

Also verify session resume while here: note the `Session: <id>` line printed at startup, exit with `/exit`, then run `node bin/forge.js --resume <id>` and confirm it picks the conversation back up (e.g. ask "what did I just ask you to do?" and check it remembers).

---

## Sprint 4 Definition of Done

- [ ] All automated tests across Tasks 1-4 pass (`npm test`), full suite green including Sprints 1-3's tests.
- [ ] `npm run typecheck` and `npm run typecheck:test` both report no errors.
- [ ] `forge` CLI starts, accepts input, streams output, and asks for real terminal y/n approval before running `bash`/`write_file`/`edit_file` (Task 3's manual sanity check plus Task 4's Step 5 smoke test).
- [ ] Session resume by id works from the CLI (Task 3's automated tests plus Task 4's Step 5 manual check).
- [ ] MCP tools never collide with built-in tools by name (Task 2's automated tests).
- [ ] Forge is pointed at its own repo and makes a real, verified one-line code change end-to-end via the CLI (Task 4's Step 5 manual smoke test) -- this closes out every functional requirement in [PRD.md](../../PRD.md) section 7.

Once this Definition of Done is met, the kernel phase (Sprints 1-4) is complete. Later phases (multi-model routing, multi-agent orchestration, deeper dev-tool integrations) each get their own spec, per [PRD.md](../../PRD.md) section 3's non-goals.
