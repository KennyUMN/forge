import { describe, it, expect } from "vitest";
import { createRenderer } from "../../src/cli/render.js";
import type { TurnEvent } from "../../src/agent/turn-events.js";

function captureStream(): { stream: NodeJS.WriteStream; output: () => string } {
  let buffer = "";
  const stream = {
    isTTY: false,
    write: (chunk: string) => {
      buffer += chunk;
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, output: () => buffer };
}

function render(events: TurnEvent[], showThinking = false): string {
  const { stream, output } = captureStream();
  const renderer = createRenderer({ stream, showThinking });
  for (const event of events) renderer(event);
  return output();
}

const call = { id: "c1", name: "read_file", input: { path: "a.ts" } };

describe("createRenderer", () => {
  it("writes assistant text verbatim", () => {
    expect(render([{ type: "text_delta", text: "hello " }, { type: "text_delta", text: "world" }])).toBe(
      "hello world",
    );
  });

  // The whole point of the event stream: an auto-allowed tool used to run with
  // no output at all, so the user saw a pause and then text.
  it("shows a tool call and its result", () => {
    const output = render([
      { type: "tool_call", call },
      { type: "tool_result", call, result: { toolCallId: "c1", output: "contents", isError: false } },
    ]);

    expect(output).toContain("read_file");
    expect(output).toContain('{"path":"a.ts"}');
    expect(output).toContain("contents");
  });

  // Otherwise a tool call invoked mid-sentence appends to the assistant's own
  // line and the two run together.
  it("breaks the line before a tool call when text was mid-line", () => {
    const output = render([
      { type: "text_delta", text: "let me look" },
      { type: "tool_call", call },
    ]);

    expect(output).toBe("let me look\n  read_file({\"path\":\"a.ts\"})\n");
  });

  it("does not add a blank line when the text already ended in a newline", () => {
    const output = render([
      { type: "text_delta", text: "looking\n" },
      { type: "tool_call", call },
    ]);

    expect(output).not.toContain("\n\n");
  });

  it("hides thinking unless it is asked for", () => {
    expect(render([{ type: "thinking_delta", text: "pondering" }])).toBe("");
    expect(render([{ type: "thinking_delta", text: "pondering" }], true)).toContain("pondering");
  });

  // A read_file result can be an entire file; the session log keeps the full
  // text, the terminal does not need it.
  it("clips a long tool result and says how much it hid", () => {
    const output = render([
      {
        type: "tool_result",
        call,
        result: { toolCallId: "c1", output: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"), isError: false },
      },
    ]);

    expect(output).toContain("line 5");
    expect(output).not.toContain("line 9");
    expect(output).toContain("more line(s)");
  });

  it("clips an over-long tool input rather than printing the whole payload", () => {
    const output = render([{ type: "tool_call", call: { id: "c1", name: "write_file", input: { text: "x".repeat(500) } } }]);

    expect(output).toContain("...");
    expect(output.length).toBeLessThan(200);
  });

  // Escape sequences written into a redirected stream become literal garbage
  // in the file, so colour is a TTY-only decision.
  it("emits no escape sequences when the stream is not a terminal", () => {
    const output = render([
      { type: "tool_result", call, result: { toolCallId: "c1", output: "boom", isError: true } },
    ]);

    expect(output).not.toContain("\x1b");
  });

  it("ignores step boundary events, which exist for renderers that want them", () => {
    expect(render([{ type: "step_start", step: 1 }, { type: "step_end", step: 1, finishReason: "completed" }])).toBe("");
  });
});
