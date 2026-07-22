import type { ToolCallRequest } from "../types/tool-call.js";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionPolicy {
  name: string;
  evaluate(call: ToolCallRequest): PermissionDecision | undefined;
}

// These names match the built-in tools Sprint 3 will register (design spec
// section 4.6): read_file/grep/glob are read-only, write_file/edit_file/bash
// can change state or run arbitrary commands.
const READ_ONLY_TOOL_NAMES = new Set(["read_file", "grep", "glob"]);
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
