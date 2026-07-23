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

// Editing a file is reversible -- the change is on disk, visible to git, and
// undoable. Running a shell command is not, so accept-edits stops short of it
// rather than treating "writes" and "commands" as one category.
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

// The modes a user cycles through at the prompt. Ordered from most to least
// supervised, which is the order shift+tab moves in.
export const PERMISSION_MODES = ["ask", "accept-edits", "auto"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function nextPermissionMode(mode: PermissionMode): PermissionMode {
  return PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode) + 1) % PERMISSION_MODES.length];
}

export function policiesForMode(mode: PermissionMode): PermissionPolicy[] {
  switch (mode) {
    case "auto":
      return [allowEverythingPolicy];
    case "accept-edits":
      return [autoAllowReadOnlyPolicy, autoAllowEditsPolicy, askBeforeWriteOrBashPolicy];
    case "ask":
      return DEFAULT_PERMISSION_POLICIES;
  }
}
