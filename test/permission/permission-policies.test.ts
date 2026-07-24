import { describe, it, expect } from "vitest";
import {
  autoAllowReadOnlyPolicy,
  askBeforeWriteOrBashPolicy,
  planModePolicies,
  createBlockListPolicy,
  createDenyListPolicy,
  createAllowListPolicy,
} from "../../src/permission/permission-policies.js";
import type { ToolCallRequest } from "../../src/types/tool-call.js";

function decideChain(policies: { evaluate(call: ToolCallRequest): string | undefined }[], name: string): string {
  const call: ToolCallRequest = { id: "c1", name, input: {} };
  for (const policy of policies) {
    const decision = policy.evaluate(call);
    if (decision) return decision;
  }
  return "ask";
}

describe("autoAllowReadOnlyPolicy", () => {
  it("allows read_file", () => {
    expect(autoAllowReadOnlyPolicy.evaluate({ id: "1", name: "read_file", input: {} })).toBe("allow");
  });

  it("does not decide on bash", () => {
    expect(autoAllowReadOnlyPolicy.evaluate({ id: "1", name: "bash", input: {} })).toBeUndefined();
  });
});

describe("askBeforeWriteOrBashPolicy", () => {
  it("asks before bash", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "bash", input: {} })).toBe("ask");
  });

  it("asks before write_file", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "write_file", input: {} })).toBe("ask");
  });

  it("does not decide on read_file", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "read_file", input: {} })).toBeUndefined();
  });
});

describe("planModePolicies", () => {
  it("allows read_file", () => {
    expect(decideChain(planModePolicies, "read_file")).toBe("allow");
  });

  it("allows glob", () => {
    expect(decideChain(planModePolicies, "glob")).toBe("allow");
  });

  it("allows grep", () => {
    expect(decideChain(planModePolicies, "grep")).toBe("allow");
  });

  it("denies write_file", () => {
    expect(decideChain(planModePolicies, "write_file")).toBe("deny");
  });

  it("denies edit_file", () => {
    expect(decideChain(planModePolicies, "edit_file")).toBe("deny");
  });

  it("denies bash", () => {
    expect(decideChain(planModePolicies, "bash")).toBe("deny");
  });
});

describe("createBlockListPolicy", () => {
  it("returns block for a tool in the list", () => {
    const policy = createBlockListPolicy(["bash", "write_file"]);
    expect(policy.evaluate({ id: "1", name: "bash", input: {} })).toBe("block");
    expect(policy.evaluate({ id: "1", name: "write_file", input: {} })).toBe("block");
  });

  it("returns undefined for a tool not in the list", () => {
    const policy = createBlockListPolicy(["bash"]);
    expect(policy.evaluate({ id: "1", name: "read_file", input: {} })).toBeUndefined();
  });
});

describe("createDenyListPolicy", () => {
  it("returns deny for a tool in the list", () => {
    const policy = createDenyListPolicy(["bash"]);
    expect(policy.evaluate({ id: "1", name: "bash", input: {} })).toBe("deny");
  });

  it("returns undefined for a tool not in the list", () => {
    const policy = createDenyListPolicy(["bash"]);
    expect(policy.evaluate({ id: "1", name: "read_file", input: {} })).toBeUndefined();
  });
});

describe("createAllowListPolicy", () => {
  it("returns allow for a tool in the list", () => {
    const policy = createAllowListPolicy(["read_file", "grep"]);
    expect(policy.evaluate({ id: "1", name: "read_file", input: {} })).toBe("allow");
    expect(policy.evaluate({ id: "1", name: "grep", input: {} })).toBe("allow");
  });

  it("returns undefined for a tool not in the list", () => {
    const policy = createAllowListPolicy(["read_file"]);
    expect(policy.evaluate({ id: "1", name: "bash", input: {} })).toBeUndefined();
  });
});

describe("block takes precedence over allow", () => {
  it("block wins when both block and allow policies match", () => {
    const block = createBlockListPolicy(["bash"]);
    const allow = createAllowListPolicy(["bash"]);
    expect(decideChain([block, allow], "bash")).toBe("block");
  });
});
