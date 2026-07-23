import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { parseMarkdown } from "./markdown.js";
import type { Span } from "./markdown.js";
import type { TranscriptItem } from "./transcript-model.js";
import type { ToolCallRequest, ToolResult } from "../types/tool-call.js";

const MAX_INPUT_CHARS = 70;
const MAX_RESULT_LINES = 8;

// Braille frames render in every terminal worth targeting and, unlike the
// ASCII |/-\ spinner, occupy exactly one column in all of them -- a
// double-width frame would make the line it sits on jitter as it animates.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ELLIPSIS = "…";
const CHECK = "✓";
const CROSS = "✗";
const BULLET = "•";
const CHEVRON = "›";
const MIDDOT = "·";

export function spinnerFrame(frame: number): string {
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
}

// Tool inputs are arbitrary model-supplied JSON -- a write_file call carries
// the entire file contents -- so the header line shows only a prefix. The
// session log keeps the untruncated version.
export function summariseInput(call: ToolCallRequest): string {
  const json = JSON.stringify(call.input) ?? "";
  return json.length > MAX_INPUT_CHARS ? `${json.slice(0, MAX_INPUT_CHARS)}${ELLIPSIS}` : json;
}

export function clipResult(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_RESULT_LINES) return output;
  const hidden = lines.length - MAX_RESULT_LINES;
  return [...lines.slice(0, MAX_RESULT_LINES), `${ELLIPSIS} ${hidden} more line(s)`].join("\n");
}

export function ToolRow({
  call,
  result,
  frame = 0,
}: {
  call: ToolCallRequest;
  result?: ToolResult;
  frame?: number;
}): ReactElement {
  const marker = result ? (result.isError ? CROSS : CHECK) : BULLET;
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text color={result?.isError ? "red" : "cyan"}>
        {marker} {call.name}
        <Text dimColor>({summariseInput(call)})</Text>
      </Text>
      <Box marginLeft={2}>
        {result ? (
          <Text dimColor color={result.isError ? "red" : undefined}>
            {clipResult(result.output)}
          </Text>
        ) : (
          <Text dimColor>{spinnerFrame(frame)} running</Text>
        )}
      </Box>
    </Box>
  );
}

function InlineSpans({ spans }: { spans: Span[] }): ReactElement {
  return (
    <Text>
      {spans.map((span, index) => (
        <Text key={index} bold={span.bold} italic={span.italic} color={span.code ? "yellow" : undefined}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

// Renders the small Markdown subset models actually emit. Without this a reply
// shows its own syntax -- literal **stars**, ## hashes and ``` fences -- which
// is exactly the raw text the model meant to format.
export function Markdown({ source }: { source: string }): ReactElement {
  const blocks = parseMarkdown(source);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Box key={index} marginTop={index === 0 ? 0 : 1}>
                <Text bold color={block.level <= 2 ? "cyan" : undefined}>
                  <InlineSpans spans={block.spans} />
                </Text>
              </Box>
            );
          case "bullet":
            return (
              <Box key={index}>
                <Text dimColor>{"  " + BULLET + " "}</Text>
                <InlineSpans spans={block.spans} />
              </Box>
            );
          case "code":
            return (
              <Box
                key={index}
                flexDirection="column"
                marginY={1}
                marginLeft={2}
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
              >
                {block.language && <Text dimColor>{block.language}</Text>}
                {block.lines.map((line, lineIndex) => (
                  <Text key={lineIndex} color="yellow">
                    {line || " "}
                  </Text>
                ))}
              </Box>
            );
          case "rule":
            return <Divider key={index} width={40} />;
          case "paragraph":
            return (
              <Box key={index} marginTop={index === 0 ? 0 : 1}>
                <InlineSpans spans={block.spans} />
              </Box>
            );
        }
      })}
    </Box>
  );
}

export function TranscriptRow({ item, frame = 0 }: { item: TranscriptItem; frame?: number }): ReactElement {
  return <TranscriptView items={[item]} frame={frame} />;
}

export function TranscriptView({ items, frame = 0 }: { items: TranscriptItem[]; frame?: number }): ReactElement {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        switch (item.kind) {
          case "user":
            return (
              <Box key={index} marginTop={1}>
                <Text bold color="green">
                  {CHEVRON}{" "}
                </Text>
                <Text>{item.text}</Text>
              </Box>
            );
          case "assistant":
            return (
              <Box key={index} marginTop={1}>
                <Markdown source={item.text} />
              </Box>
            );
          case "tool":
            return <ToolRow key={index} call={item.call} result={item.result} frame={frame} />;
          case "notice":
            return (
              <Box key={index} marginTop={1}>
                <Text dimColor italic>
                  {item.text}
                </Text>
              </Box>
            );
        }
      })}
    </Box>
  );
}

export function ThinkingView({ text, frame }: { text: string; frame: number }): ReactElement | null {
  if (!text) return null;
  // Only the tail, on one line: reasoning streams run to thousands of tokens
  // and the useful part is what the model is weighing right now. Letting it
  // grow would push the prompt off the bottom of the screen.
  const tail = text.slice(-200).replace(/\s+/g, " ").trim();
  return (
    <Box marginLeft={2}>
      <Text dimColor>
        {spinnerFrame(frame)} {tail}
      </Text>
    </Box>
  );
}

export function PermissionPrompt({ call }: { call: ToolCallRequest }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">
        Allow {call.name}?
      </Text>
      <Text dimColor>{summariseInput(call)}</Text>
      <Text>
        <Text bold>y</Text> allow {MIDDOT} <Text bold>n</Text> deny
      </Text>
    </Box>
  );
}

// A rule the full width of the terminal, framing the prompt the way the
// reference CLIs do. Ink gives no "100% width" primitive for a bare character
// run, so the width is measured and the string built.
export function Divider({ width = process.stdout.columns || 80 }: { width?: number }): ReactElement {
  return (
    <Text dimColor>{"─".repeat(Math.max(1, width))}</Text>
  );
}

const LOGO_LINES = ["▄█▀▀█▄", "█▀  ▀█", "█▄▄▄▄▀", "█▀    "];

export interface BannerProps {
  version: string;
  provider: string;
  model: string;
  cwd: string;
}

export function Banner({ version, provider, model, cwd }: BannerProps): ReactElement {
  return (
    <Box marginBottom={1}>
      <Box flexDirection="column" marginRight={2}>
        {LOGO_LINES.map((line, index) => (
          <Text key={index} color={["red", "yellow", "green", "cyan"][index]}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold color="cyan">
          Forge {version}
        </Text>
        <Text dimColor>
          {provider} {MIDDOT} {model}
        </Text>
        <Text dimColor>{cwd}</Text>
        <Text dimColor>? for shortcuts</Text>
      </Box>
    </Box>
  );
}

const BAR_WIDTH = 12;
const BAR_FULL = "█";
const BAR_EMPTY = "░";

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

// Returns the filled/empty split rather than a rendered string so the caller
// can colour the two halves differently.
export function contextBarCells(used: number, total: number): { filled: number; empty: number; percent: number } {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  // Rounds up so any non-zero usage shows at least one cell -- a bar reading
  // completely empty while tokens are being spent is worse than being a cell
  // optimistic.
  const filled = used > 0 ? Math.max(1, Math.ceil(ratio * BAR_WIDTH)) : 0;
  return { filled, empty: BAR_WIDTH - filled, percent: Math.round(ratio * 100) };
}

export function ContextBar({ used, total }: { used: number; total: number }): ReactElement {
  const { filled, empty, percent } = contextBarCells(used, total);
  // Amber past two thirds, red past nine tenths: the point of the bar is to
  // warn before a turn starts failing on context length, not after.
  const color = percent >= 90 ? "red" : percent >= 66 ? "yellow" : "green";
  return (
    <Text>
      <Text dimColor>Context: [</Text>
      <Text color={color}>{BAR_FULL.repeat(filled)}</Text>
      <Text dimColor>
        {BAR_EMPTY.repeat(empty)}] {formatTokens(used)}/{formatTokens(total)} ({percent}%)
      </Text>
    </Text>
  );
}

export interface StatusBarProps {
  mode: string;
  provider: string;
  model: string;
  branch?: string;
  usedTokens?: number;
  contextWindow: number;
  busy: boolean;
  frame: number;
}

const MODE_COLORS: Record<string, string> = {
  ask: "cyan",
  "accept-edits": "green",
  auto: "yellow",
};

export function StatusBar({
  mode,
  provider,
  model,
  branch,
  usedTokens,
  contextWindow,
  busy,
  frame,
}: StatusBarProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={MODE_COLORS[mode] ?? "white"} bold>
          [{mode}]
        </Text>
        <Text dimColor>
          {" "}
          | {provider}/{model} |{" "}
        </Text>
        {usedTokens === undefined ? (
          <Text dimColor>Context: (not reported)</Text>
        ) : (
          <ContextBar used={usedTokens} total={contextWindow} />
        )}
        <Text dimColor> | {branch ? `⎇ ${branch}` : "no git"}</Text>
      </Box>
      <Box>
        <Text dimColor>
          {busy ? `${spinnerFrame(frame)} working ${MIDDOT} ctrl-c interrupt` : "shift+tab cycle mode"} {MIDDOT} /exit
          quit
        </Text>
      </Box>
    </Box>
  );
}
