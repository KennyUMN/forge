import { describe, it, expect } from "vitest";
import { parseInline, parseMarkdown } from "../../src/tui/markdown.js";

describe("parseInline", () => {
  it("returns plain text as a single span", () => {
    expect(parseInline("just words")).toEqual([{ text: "just words" }]);
  });

  it("returns nothing for an empty string", () => {
    expect(parseInline("")).toEqual([]);
  });

  it("marks bold, italic and code spans", () => {
    expect(parseInline("**b**")).toEqual([{ text: "b", bold: true }]);
    expect(parseInline("__b__")).toEqual([{ text: "b", bold: true }]);
    expect(parseInline("*i*")).toEqual([{ text: "i", italic: true }]);
    expect(parseInline("`c`")).toEqual([{ text: "c", code: true }]);
  });

  it("keeps the text around a styled span", () => {
    expect(parseInline("a **b** c")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c" },
    ]);
  });

  // Longest delimiter first, or "**bold**" reads as an italic wrapping "*bold".
  it("reads double stars as bold rather than nested italics", () => {
    expect(parseInline("**bold**")).toEqual([{ text: "bold", bold: true }]);
  });

  // Whichever delimiter opens earliest wins, so the bold rule cannot reach
  // inside a code span that started before it.
  it("leaves markup inside a code span literal", () => {
    expect(parseInline("`a **b** c`")).toEqual([{ text: "a **b** c", code: true }]);
  });

  it("handles several spans in one line", () => {
    expect(parseInline("**a** and `b`")).toEqual([
      { text: "a", bold: true },
      { text: " and " },
      { text: "b", code: true },
    ]);
  });

  // A stray asterisk is far more common than a malformed emphasis, and eating
  // it would silently change the model's text.
  it("leaves an unclosed delimiter as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads a heading and its level", () => {
    expect(parseMarkdown("## Core Capabilities")).toEqual([
      { kind: "heading", level: 2, spans: [{ text: "Core Capabilities" }] },
    ]);
  });

  it("reads bullets written with any marker", () => {
    const blocks = parseMarkdown("- one\n* two\n+ three");

    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.kind === "bullet")).toBe(true);
  });

  it("reads numbered list items as bullets", () => {
    expect(parseMarkdown("1. first\n2) second").map((b) => b.kind)).toEqual(["bullet", "bullet"]);
  });

  it("keeps inline styling inside a bullet", () => {
    expect(parseMarkdown("- **Read** files")).toEqual([
      { kind: "bullet", spans: [{ text: "Read", bold: true }, { text: " files" }] },
    ]);
  });

  it("reads a fenced code block with its language", () => {
    const blocks = parseMarkdown("```ts\nconst x = 1;\nconst y = 2;\n```");

    expect(blocks).toEqual([{ kind: "code", language: "ts", lines: ["const x = 1;", "const y = 2;"] }]);
  });

  it("reads a fence with no language", () => {
    expect(parseMarkdown("```\nplain\n```")).toEqual([{ kind: "code", language: undefined, lines: ["plain"] }]);
  });

  // Mid-stream the closing fence has not arrived yet; discarding the body
  // would make code vanish and reappear as the response streams in.
  it("keeps the body of an unterminated fence", () => {
    expect(parseMarkdown("```js\nhalf written")).toEqual([
      { kind: "code", language: "js", lines: ["half written"] },
    ]);
  });

  it("does not read markup inside a code block", () => {
    expect(parseMarkdown("```\n## not a heading\n```")).toEqual([
      { kind: "code", language: undefined, lines: ["## not a heading"] },
    ]);
  });

  it("reads a horizontal rule", () => {
    expect(parseMarkdown("---")).toEqual([{ kind: "rule" }]);
  });

  // The model hard-wraps its own paragraphs; keeping those breaks would wrap
  // twice and leave a ragged column.
  it("joins a hard-wrapped paragraph into one block", () => {
    expect(parseMarkdown("one line\nand another")).toEqual([
      { kind: "paragraph", spans: [{ text: "one line and another" }] },
    ]);
  });

  it("separates paragraphs on a blank line", () => {
    expect(parseMarkdown("first\n\nsecond").map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("parses a whole reply with mixed blocks in order", () => {
    const blocks = parseMarkdown("## Title\n\nSome **bold** text.\n\n- a\n- b\n\n```sh\nls\n```");

    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "bullet", "bullet", "code"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});
