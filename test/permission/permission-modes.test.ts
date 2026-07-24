import { describe, it, expect } from "vitest";
import {
  PERMISSION_MODES,
  nextPermissionMode,
  policiesForMode,
} from "../../src/permission/permission-policies.js";
import type { PermissionMode } from "../../src/permission/permission-policies.js";
import type { ToolCallRequest } from "../../src/types/tool-call.js";

function decide(mode: PermissionMode, name: string): string {
  const call: ToolCallRequest = { id: "c1", name, input: {} };
  for (const policy of policiesForMode(mode)) {
    const decision = policy.evaluate(call);
    if (decision) return decision;
  }
  return "ask";
}

describe("nextPermissionMode", () => {
  it("cycles through every mode and returns to the start", () => {
    let mode: PermissionMode = "plan";
    const seen: PermissionMode[] = [mode];
    for (let i = 0; i < PERMISSION_MODES.length - 1; i++) {
      mode = nextPermissionMode(mode);
      seen.push(mode);
    }

    expect(seen).toEqual([...PERMISSION_MODES]);
    expect(nextPermissionMode(mode)).toBe("plan");
  });

  it("orders modes from most to least supervised: plan → ask → accept-edits → auto", () => {
    expect(PERMISSION_MODES[0]).toBe("plan");
    expect(PERMISSION_MODES[1]).toBe("ask");
    expect(PERMISSION_MODES[2]).toBe("accept-edits");
    expect(PERMISSION_MODES[3]).toBe("auto");
  });
});

describe("policiesForMode", () => {
  it("plan: allows read-only tools", () => {
    expect(decide("plan", "read_file")).toBe("allow");
    expect(decide("plan", "grep")).toBe("allow");
    expect(decide("plan", "glob")).toBe("allow");
  });

  it("plan: denies write tools and bash", () => {
    expect(decide("plan", "write_file")).toBe("deny");
    expect(decide("plan", "edit_file")).toBe("deny");
    expect(decide("plan", "bash")).toBe("deny");
  });

  it("ask: allows reads, asks before writes and bash", () => {
    expect(decide("ask", "read_file")).toBe("allow");
    expect(decide("ask", "grep")).toBe("allow");
    expect(decide("ask", "write_file")).toBe("ask");
    expect(decide("ask", "bash")).toBe("ask");
  });

  it("accept-edits: allows file edits but still asks before bash", () => {
    expect(decide("accept-edits", "write_file")).toBe("allow");
    expect(decide("accept-edits", "edit_file")).toBe("allow");
    expect(decide("accept-edits", "bash")).toBe("ask");
    expect(decide("accept-edits", "read_file")).toBe("allow");
  });

  it("auto: allows everything, including tools it has never heard of", () => {
    expect(decide("auto", "bash")).toBe("allow");
    expect(decide("auto", "write_file")).toBe("allow");
    expect(decide("auto", "some_mcp_tool")).toBe("allow");
  });

  it("asks about an unrecognised tool in supervised modes", () => {
    expect(decide("ask", "some_mcp_tool")).toBe("ask");
    expect(decide("accept-edits", "some_mcp_tool")).toBe("ask");
  });
});
