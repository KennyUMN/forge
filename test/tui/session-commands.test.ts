import { describe, it, expect } from "vitest";
import {
  isSlashInput,
  parseSlashInput,
  runSlashCommand,
  SESSION_COMMANDS,
} from "../../src/tui/session-commands.js";
import type { SlashContext } from "../../src/tui/session-commands.js";

function ctx(overrides: Partial<SlashContext> = {}): SlashContext {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    cwd: "/repo",
    branch: "main",
    mode: "ask",
    usedTokens: undefined,
    contextWindow: 200_000,
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "gpt-4o"],
    canSwitchModel: true,
    canCompact: true,
    canRunAgent: true,
    ...overrides,
  };
}

describe("isSlashInput", () => {
  it("is true for a leading slash, ignoring leading whitespace", () => {
    expect(isSlashInput("/help")).toBe(true);
    expect(isSlashInput("  /help")).toBe(true);
  });
  it("is false for ordinary prompts", () => {
    expect(isSlashInput("fix the bug")).toBe(false);
    expect(isSlashInput("what is /etc for?")).toBe(false);
  });
});

describe("parseSlashInput", () => {
  it("splits the command name from token args", () => {
    expect(parseSlashInput("/model gpt-4o")).toEqual({ name: "model", args: ["gpt-4o"], rest: "gpt-4o" });
  });
  it("lowercases the command name but keeps args verbatim", () => {
    expect(parseSlashInput("/MODEL GPT-4o")).toEqual({ name: "model", args: ["GPT-4o"], rest: "GPT-4o" });
  });
  it("keeps the free-form remainder intact for sentence args", () => {
    const parsed = parseSlashInput("/agent  fix the flaky test ");
    expect(parsed).toEqual({ name: "agent", args: ["fix", "the", "flaky", "test"], rest: "fix the flaky test" });
  });
  it("returns null for non-slash input", () => {
    expect(parseSlashInput("hello")).toBeNull();
  });
  it("parses a bare slash to an empty name", () => {
    expect(parseSlashInput("/")).toEqual({ name: "", args: [], rest: "" });
  });
});

describe("runSlashCommand", () => {
  it("/help lists every registered command", () => {
    const result = runSlashCommand("/help", ctx());
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toBe("commands:");
    for (const cmd of SESSION_COMMANDS) {
      expect(result.lines.some((l) => l.includes(cmd.usage) && l.includes(cmd.description))).toBe(true);
    }
  });

  it("/usage reports unknown when no tokens have been counted", () => {
    const result = runSlashCommand("/usage", ctx({ usedTokens: undefined }));
    expect(result.lines[0]).toContain("unknown");
  });

  it("/usage reports the percentage of the context window used", () => {
    const result = runSlashCommand("/usage", ctx({ usedTokens: 50_000, contextWindow: 200_000 }));
    expect(result.lines[0]).toContain("50,000");
    expect(result.lines[0]).toContain("200,000");
    expect(result.lines[0]).toContain("(25%)");
  });

  it("/config shows provider, model, mode, cwd and branch", () => {
    const result = runSlashCommand("/config", ctx({ provider: "openai", model: "gpt-4o", mode: "auto", branch: "feat/x" }));
    const joined = result.lines.join("\n");
    expect(joined).toContain("provider: openai");
    expect(joined).toContain("model:    gpt-4o");
    expect(joined).toContain("mode:     auto");
    expect(joined).toContain("branch:   feat/x");
  });

  it("/model with no argument shows the current model and the catalog", () => {
    const result = runSlashCommand("/model", ctx());
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("claude-sonnet-4-20250514");
    expect(result.lines.join("\n")).toContain("gpt-4o");
  });

  it("/model <id> requests a switch when switching is supported", () => {
    const result = runSlashCommand("/model gpt-4o", ctx());
    expect(result.effect).toEqual({ kind: "switch_model", model: "gpt-4o" });
  });

  it("/model to the current model is a no-op", () => {
    const result = runSlashCommand("/model gpt-4o", ctx({ model: "gpt-4o" }));
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("already on");
  });

  it("/model flags an id outside the known catalog but still switches", () => {
    const result = runSlashCommand("/model some-new-model", ctx());
    expect(result.effect).toEqual({ kind: "switch_model", model: "some-new-model" });
    expect(result.lines.join("\n")).toContain("not in the known catalog");
  });

  it("/model degrades gracefully when switching is unsupported", () => {
    const result = runSlashCommand("/model gpt-4o", ctx({ canSwitchModel: false }));
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("not supported");
  });

  it("/mode with no argument shows the current mode and options", () => {
    const result = runSlashCommand("/mode", ctx({ mode: "ask" }));
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("ask");
    expect(result.lines.join("\n")).toContain("accept-edits");
  });

  it("/mode <valid> sets the permission mode", () => {
    const result = runSlashCommand("/mode auto", ctx({ mode: "ask" }));
    expect(result.effect).toEqual({ kind: "set_mode", mode: "auto" });
  });

  it("/mode rejects an unknown mode", () => {
    const result = runSlashCommand("/mode yolo", ctx());
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("unknown mode");
  });

  it("/compact requests compaction when available", () => {
    const result = runSlashCommand("/compact", ctx({ canCompact: true }));
    expect(result.effect).toEqual({ kind: "compact" });
  });

  it("/compact degrades gracefully when unavailable", () => {
    const result = runSlashCommand("/compact", ctx({ canCompact: false }));
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("not available");
  });

  it("/agent <task> requests a subagent run", () => {
    const result = runSlashCommand("/agent fix the flaky test", ctx());
    expect(result.effect).toEqual({ kind: "run_agent", task: "fix the flaky test" });
  });

  it("/agent with no task shows usage", () => {
    const result = runSlashCommand("/agent", ctx());
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("usage");
  });

  it("/clear requests a screen clear", () => {
    expect(runSlashCommand("/clear", ctx()).effect).toEqual({ kind: "clear" });
  });

  it("/exit and /quit request exit", () => {
    expect(runSlashCommand("/exit", ctx()).effect).toEqual({ kind: "exit" });
    expect(runSlashCommand("/quit", ctx()).effect).toEqual({ kind: "exit" });
  });

  it("reports an unknown command", () => {
    const result = runSlashCommand("/frobnicate", ctx());
    expect(result.effect).toEqual({ kind: "none" });
    expect(result.lines[0]).toContain("unknown command");
  });
});
