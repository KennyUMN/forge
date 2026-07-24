import { describe, it, expect } from "vitest";
import { wrapUntrusted, taintToolOutput } from "../../src/tool/taint.js";
import { boundOutput } from "../../src/tool/output-bounds.js";

describe("wrapUntrusted", () => {
  it("wraps content with untrusted boundary markers", () => {
    const result = wrapUntrusted("some output", "bash:ls -la");
    expect(result).toBe(
      '\n<untrusted_content source="bash:ls -la">\nsome output\n</untrusted_content>\n',
    );
  });

  it("preserves multiline content verbatim inside markers", () => {
    const content = "line1\nline2\nline3";
    const result = wrapUntrusted(content, "read_file:/tmp/foo.ts");
    expect(result).toContain("line1\nline2\nline3");
    expect(result).toContain('<untrusted_content source="read_file:/tmp/foo.ts">');
    expect(result).toContain("</untrusted_content>");
  });
});

describe("taintToolOutput", () => {
  it("taints bash tool output with descriptive source", () => {
    const result = taintToolOutput("file listing", "bash", { command: "ls -la" });
    expect(result).toContain('<untrusted_content source="bash:ls -la">');
    expect(result).toContain("file listing");
    expect(result).toContain("</untrusted_content>");
  });

  it("taints read_file tool output with file path source", () => {
    const result = taintToolOutput("contents", "read_file", { file_path: "/src/index.ts" });
    expect(result).toContain('<untrusted_content source="read_file:/src/index.ts">');
  });

  it("taints grep tool output", () => {
    const result = taintToolOutput("matches", "grep", { pattern: "TODO" });
    expect(result).toContain('<untrusted_content source="grep:TODO">');
  });

  it("taints glob tool output", () => {
    const result = taintToolOutput("files", "glob", { pattern: "**/*.ts" });
    expect(result).toContain('<untrusted_content source="glob:**/*.ts">');
  });

  it("taints MCP tool output with server and tool name", () => {
    const result = taintToolOutput("data", "mcp__github__search", { query: "repos" });
    expect(result).toContain('<untrusted_content source="mcp:github__search">');
  });

  it("does NOT taint write tool output", () => {
    const result = taintToolOutput("written", "write", { file_path: "/tmp/x.ts" });
    expect(result).toBe("written");
  });

  it("does NOT taint edit tool output", () => {
    const result = taintToolOutput("edited", "edit", { file_path: "/tmp/x.ts" });
    expect(result).toBe("edited");
  });

  it("does NOT taint unknown non-reading tools", () => {
    const result = taintToolOutput("ok", "todo_write", { items: [] });
    expect(result).toBe("ok");
  });
});

describe("integration: taint then bound", () => {
  it("preserves taint markers after bounding a large output", () => {
    const largeOutput = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
    const tainted = taintToolOutput(largeOutput, "bash", { command: "cat big.log" });
    const bounded = boundOutput(tainted);

    expect(bounded).toContain('<untrusted_content source="bash:cat big.log">');
    expect(bounded).toContain("</untrusted_content>");
    expect(bounded).toContain("elided");
  });
});
