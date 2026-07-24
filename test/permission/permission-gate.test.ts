import { describe, it, expect, vi } from "vitest";
import { PermissionGate } from "../../src/permission/permission-gate.js";
import type { PermissionPolicy } from "../../src/permission/permission-policies.js";
import { allowEverythingPolicy, createBlockListPolicy } from "../../src/permission/permission-policies.js";

const call = { id: "1", name: "bash", input: { command: "ls" } };

describe("PermissionGate", () => {
  it("allows a call when the first matching policy allows it", async () => {
    const policy: PermissionPolicy = { name: "always-allow", evaluate: () => "allow" };
    const ask = vi.fn();
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(result).toEqual({ decision: "allow" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("denies a call when the first matching policy denies it", async () => {
    const policy: PermissionPolicy = { name: "always-deny", evaluate: () => "deny" };
    const gate = new PermissionGate([policy], vi.fn());

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("always-deny");
  });

  it("stops at the first policy that returns a decision, ignoring later policies", async () => {
    const first: PermissionPolicy = { name: "first", evaluate: () => "allow" };
    const second: PermissionPolicy = { name: "second", evaluate: () => "deny" };
    const gate = new PermissionGate([first, second], vi.fn());

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("allow");
  });

  it("skips a policy that returns undefined and consults the next one", async () => {
    const first: PermissionPolicy = { name: "first", evaluate: () => undefined };
    const second: PermissionPolicy = { name: "second", evaluate: () => "allow" };
    const gate = new PermissionGate([first, second], vi.fn());

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("allow");
  });

  it("asks and allows when a policy says ask and the ask function approves", async () => {
    const policy: PermissionPolicy = { name: "ask-policy", evaluate: () => "ask" };
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(ask).toHaveBeenCalledWith(call);
    expect(result).toEqual({ decision: "allow" });
  });

  it("asks and denies when the ask function rejects", async () => {
    const policy: PermissionPolicy = { name: "ask-policy", evaluate: () => "ask" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("denied by user");
  });

  it("defaults to ask when no policy matches", async () => {
    const policy: PermissionPolicy = { name: "no-op", evaluate: () => undefined };
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call);

    expect(ask).toHaveBeenCalled();
    expect(result.decision).toBe("allow");
  });

  it("forceAsk bypasses every policy and asks directly", async () => {
    const policy: PermissionPolicy = { name: "always-allow", evaluate: () => "allow" };
    const ask = vi.fn().mockResolvedValue(false);
    const gate = new PermissionGate([policy], ask);

    const result = await gate.evaluate(call, { forceAsk: true });

    expect(ask).toHaveBeenCalled();
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("doom-loop");
  });
});

describe("PermissionGate block decision", () => {
  it("block denies immediately without consulting the ask function", async () => {
    const blockPolicy = createBlockListPolicy(["bash"]);
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([blockPolicy], ask);

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("blocked");
    expect(result.reason).toContain(blockPolicy.name);
    expect(ask).not.toHaveBeenCalled();
  });

  it("block cannot be overridden by auto mode (allowEverythingPolicy)", async () => {
    const blockPolicy = createBlockListPolicy(["bash"]);
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([blockPolicy, allowEverythingPolicy], ask);

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("blocked");
    expect(ask).not.toHaveBeenCalled();
  });

  it("block cannot be bypassed by forceAsk (doom-loop guard)", async () => {
    const blockPolicy = createBlockListPolicy(["bash"]);
    const ask = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate([blockPolicy], ask);

    const result = await gate.evaluate(call, { forceAsk: true });

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("blocked");
    expect(ask).not.toHaveBeenCalled();
  });

  it("block takes precedence even when allow policy comes first in the chain", async () => {
    const allowPolicy: PermissionPolicy = { name: "allow-all", evaluate: () => "allow" };
    const blockPolicy = createBlockListPolicy(["bash"]);
    const ask = vi.fn();
    const gate = new PermissionGate([blockPolicy, allowPolicy], ask);

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("blocked");
  });

  it("non-blocked tools still pass through to later policies", async () => {
    const blockPolicy = createBlockListPolicy(["write_file"]);
    const ask = vi.fn();
    const gate = new PermissionGate([blockPolicy, allowEverythingPolicy], ask);

    const result = await gate.evaluate(call);

    expect(result.decision).toBe("allow");
    expect(ask).not.toHaveBeenCalled();
  });
});
