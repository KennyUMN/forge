import { describe, it, expect, vi } from "vitest";
import { dispatchToolCalls } from "../../src/agent/tool-dispatcher.js";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { Tool, ToolExecutionContext } from "../../src/tool/tool.js";
import type { PermissionPolicy } from "../../src/permission/permission-policies.js";

const context: ToolExecutionContext = { cwd: "/tmp" };

function makeTool(name: string, execute: Tool["execute"]): Tool {
  return { name, description: name, parameters: {}, execute };
}

describe("dispatchToolCalls", () => {
  it("executes an allowed tool call and returns its result", async () => {
    const echoTool = makeTool("echo", async (input) => ({ output: JSON.stringify(input), isError: false }));
    const tools = new Map([["echo", echoTool]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "echo", input: { text: "hi" } }],
      tools,
      gate,
      [],
      context,
    );

    expect(outcome.results).toEqual([{ toolCallId: "1", output: '{"text":"hi"}', isError: false }]);
  });

  it("returns an error result for an unknown tool without throwing", async () => {
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "does_not_exist", input: {} }],
      new Map(),
      gate,
      [],
      context,
    );

    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("does_not_exist");
  });

  it("returns an error result for a denied tool call and never calls execute", async () => {
    const execute = vi.fn();
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const denyAll: PermissionPolicy = { name: "deny-all", evaluate: () => "deny" };
    const gate = new PermissionGate([denyAll], vi.fn());

    const outcome = await dispatchToolCalls([{ id: "1", name: "bash", input: {} }], tools, gate, [], context);

    expect(execute).not.toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("denied");
  });

  it("catches a thrown error from a tool's execute and reports it as an error result", async () => {
    const throwingTool = makeTool("boom", async () => {
      throw new Error("kaboom");
    });
    const tools = new Map([["boom", throwingTool]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());

    const outcome = await dispatchToolCalls([{ id: "1", name: "boom", input: {} }], tools, gate, [], context);

    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("kaboom");
  });

  it("forces a permission ask on the 3rd consecutive identical call even when a policy would auto-allow", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([allowAll], ask);

    const call = { id: "3", name: "bash", input: { command: "ls" } };
    const history = [
      { id: "1", name: "bash", input: { command: "ls" } },
      { id: "2", name: "bash", input: { command: "ls" } },
    ];

    const outcome = await dispatchToolCalls([call], tools, gate, history, context);

    expect(ask).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(true);
  });

  it("returns an updated callHistory including every call attempted, without mutating the input array", async () => {
    const tools = new Map([["echo", makeTool("echo", async () => ({ output: "ok", isError: false }))]]);
    const gate = new PermissionGate([{ name: "allow-all", evaluate: () => "allow" }], vi.fn());
    const inputHistory: { id: string; name: string; input: unknown }[] = [];

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "echo", input: {} }],
      tools,
      gate,
      inputHistory,
      context,
    );

    expect(inputHistory).toEqual([]);
    expect(outcome.callHistory).toEqual([{ id: "1", name: "echo", input: {} }]);
  });

  it("appends a steering note to the output when the doom-loop check returns steer", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "tests pass", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const ask = vi.fn();
    const gate = new PermissionGate([allowAll], ask);

    const history = [
      { id: "1", name: "edit_file", input: { path: "a.ts", oldText: "x", newText: "y" } },
      { id: "2", name: "bash", input: { command: "npm test" } },
      { id: "3", name: "edit_file", input: { path: "a.ts", oldText: "y", newText: "z" } },
      { id: "4", name: "bash", input: { command: "npm test" } },
      { id: "5", name: "edit_file", input: { path: "a.ts", oldText: "z", newText: "w" } },
    ];
    const call = { id: "6", name: "bash", input: { command: "npm test" } };

    const outcome = await dispatchToolCalls([call], tools, gate, history, context);

    expect(execute).toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(outcome.results[0].output).toContain("tests pass");
    expect(outcome.results[0].output).toContain("[system note:");
    expect(outcome.results[0].output).toContain("alternating");
    expect(outcome.results[0].isError).toBe(false);
  });

  it("steer does not block execution — the tool still runs", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "done", isError: false });
    const tools = new Map([["edit_file", makeTool("edit_file", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());

    const history = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      name: "edit_file",
      input: { path: "src/app.ts", oldText: `old${i}`, newText: `new${i}` },
    }));
    const call = { id: "e5", name: "edit_file", input: { path: "src/app.ts", oldText: "a", newText: "b" } };

    const outcome = await dispatchToolCalls([call], tools, gate, history, context);

    expect(execute).toHaveBeenCalled();
    expect(outcome.results[0].output).toContain("done");
    expect(outcome.results[0].output).toContain("[system note:");
    expect(outcome.results[0].output).toContain("src/app.ts");
  });

  it("block still forces a permission prompt and denies when the user declines", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([allowAll], ask);

    const history = [
      { id: "1", name: "bash", input: { command: "ls" } },
      { id: "2", name: "bash", input: { command: "ls" } },
    ];
    const call = { id: "3", name: "bash", input: { command: "ls" } };

    const outcome = await dispatchToolCalls([call], tools, gate, history, context);

    expect(ask).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("denied");
  });
});

describe("dispatchToolCalls with hooks", () => {
  it("blocks a tool call when a pre_tool hook exits non-zero", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());
    const hooks = [{ event: "pre_tool" as const, matcher: "bash", command: "echo blocked >&2; exit 1" }];

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "bash", input: { command: "ls" } }],
      tools,
      gate,
      [],
      context,
      undefined,
      undefined,
      hooks,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(true);
    expect(outcome.results[0].output).toContain("Blocked by hook");
    expect(outcome.results[0].output).toContain("blocked");
  });

  it("allows a tool call when a pre_tool hook exits zero", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "done", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());
    const hooks = [{ event: "pre_tool" as const, matcher: "bash", command: "echo ok" }];

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "bash", input: { command: "ls" } }],
      tools,
      gate,
      [],
      context,
      undefined,
      undefined,
      hooks,
    );

    expect(execute).toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(false);
    expect(outcome.results[0].output).toContain("done");
  });

  it("runs post_tool hooks after execution without blocking the result", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "result", isError: false });
    const tools = new Map([["write_file", makeTool("write_file", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());
    const hooks = [{ event: "post_tool" as const, matcher: "write_file", command: "echo post-ran" }];

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "write_file", input: { path: "a.ts", content: "x" } }],
      tools,
      gate,
      [],
      context,
      undefined,
      undefined,
      hooks,
    );

    expect(execute).toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(false);
    expect(outcome.results[0].output).toContain("result");
  });

  it("does not run hooks that do not match the tool name", async () => {
    const execute = vi.fn().mockResolvedValue({ output: "ok", isError: false });
    const tools = new Map([["bash", makeTool("bash", execute)]]);
    const allowAll: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const gate = new PermissionGate([allowAll], vi.fn());
    const hooks = [{ event: "pre_tool" as const, matcher: "write_file", command: "exit 1" }];

    const outcome = await dispatchToolCalls(
      [{ id: "1", name: "bash", input: { command: "ls" } }],
      tools,
      gate,
      [],
      context,
      undefined,
      undefined,
      hooks,
    );

    expect(execute).toHaveBeenCalled();
    expect(outcome.results[0].isError).toBe(false);
  });
});
