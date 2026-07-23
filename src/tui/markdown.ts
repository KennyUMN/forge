// A deliberately small Markdown subset: what a coding model actually emits in
// chat replies. Anything unrecognised falls through as plain text rather than
// being dropped, so a construct this does not model is still readable.
//
// Parsed into a data structure rather than rendered straight to a string, so
// the styling decisions live in the component and the parsing is testable
// without a terminal.

export type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

export type Block =
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "bullet"; spans: Span[] }
  | { kind: "code"; language?: string; lines: string[] }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```(\w*)\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

// Ordered longest-delimiter-first so "**bold**" is not read as two italics.
const INLINE_PATTERNS: { pattern: RegExp; style: Omit<Span, "text"> }[] = [
  { pattern: /`([^`]+)`/, style: { code: true } },
  { pattern: /\*\*([^*]+)\*\*/, style: { bold: true } },
  { pattern: /__([^_]+)__/, style: { bold: true } },
  { pattern: /\*([^*]+)\*/, style: { italic: true } },
];

export function parseInline(text: string): Span[] {
  if (!text) return [];

  // Whichever delimiter opens earliest wins, so `code with **stars**` keeps its
  // stars literal instead of the bold rule reaching inside the code span.
  let earliest: { index: number; match: RegExpExecArray; style: Omit<Span, "text"> } | undefined;
  for (const { pattern, style } of INLINE_PATTERNS) {
    const match = pattern.exec(text);
    if (match && (earliest === undefined || match.index < earliest.index)) {
      earliest = { index: match.index, match, style };
    }
  }
  if (!earliest) return [{ text }];

  const { match, style } = earliest;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);

  return [
    ...(before ? [{ text: before }] : []),
    { text: match[1], ...style },
    ...parseInline(after),
  ];
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    // Joined with a space, not a newline: a hard-wrapped paragraph should
    // re-wrap to the terminal's width rather than keep the model's line breaks.
    blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ").trim()) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1] || undefined;
      const body: string[] = [];
      i++;
      // An unterminated fence runs to the end of the message rather than
      // discarding the code, which is the common case mid-stream.
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", language, lines: body });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: "bullet", spans: parseInline(bullet[1]) });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
