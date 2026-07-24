import type { ToolCallRequest } from "../types/tool-call.js";

export type PermissionDecision = "allow" | "deny" | "ask" | "block";

export interface PermissionPolicy {
  name: string;
  evaluate(call: ToolCallRequest): PermissionDecision | undefined;
}

const READ_ONLY_TOOL_NAMES = new Set(["read_file", "grep", "glob", "ask_question"]);
const APPROVAL_REQUIRED_TOOL_NAMES = new Set(["write_file", "edit_file", "bash"]);

export const autoAllowReadOnlyPolicy: PermissionPolicy = {
  name: "auto-allow-read-only",
  evaluate(call) {
    return READ_ONLY_TOOL_NAMES.has(call.name) ? "allow" : undefined;
  },
};

export const askBeforeWriteOrBashPolicy: PermissionPolicy = {
  name: "ask-before-write-or-bash",
  evaluate(call) {
    return APPROVAL_REQUIRED_TOOL_NAMES.has(call.name) ? "ask" : undefined;
  },
};

export const DEFAULT_PERMISSION_POLICIES: PermissionPolicy[] = [autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy];

const EDIT_TOOL_NAMES = new Set(["write_file", "edit_file"]);

export const autoAllowEditsPolicy: PermissionPolicy = {
  name: "auto-allow-edits",
  evaluate(call) {
    return EDIT_TOOL_NAMES.has(call.name) ? "allow" : undefined;
  },
};

export const allowEverythingPolicy: PermissionPolicy = {
  name: "allow-everything",
  evaluate() {
    return "allow";
  },
};

const denyWritePolicy: PermissionPolicy = {
  name: "deny-writes-in-plan-mode",
  evaluate(call) {
    return APPROVAL_REQUIRED_TOOL_NAMES.has(call.name) ? "deny" : undefined;
  },
};

export const planModePolicies: PermissionPolicy[] = [autoAllowReadOnlyPolicy, denyWritePolicy];

export const PERMISSION_MODES = ["plan", "ask", "accept-edits", "auto"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  return PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode) + 1) % PERMISSION_MODES.length];
}

export function policiesForMode(mode: PermissionMode): PermissionPolicy[] {
  switch (mode) {
    case "plan":
      return planModePolicies;
    case "auto":
      return [allowEverythingPolicy];
    case "accept-edits":
      return [autoAllowReadOnlyPolicy, autoAllowEditsPolicy, askBeforeWriteOrBashPolicy];
    case "ask":
      return DEFAULT_PERMISSION_POLICIES;
  }
}

export function createBlockListPolicy(blockedTools: string[]): PermissionPolicy {
  const blocked = new Set(blockedTools);
  return {
    name: "block-list",
    evaluate(call) {
      return blocked.has(call.name) ? "block" : undefined;
    },
  };
}

export function createDenyListPolicy(deniedTools: string[]): PermissionPolicy {
  const denied = new Set(deniedTools);
  return {
    name: "deny-list",
    evaluate(call) {
      return denied.has(call.name) ? "deny" : undefined;
    },
  };
}

export function createAllowListPolicy(allowedTools: string[]): PermissionPolicy {
  const allowed = new Set(allowedTools);
  return {
    name: "allow-list",
    evaluate(call) {
      return allowed.has(call.name) ? "allow" : undefined;
    },
  };
}
