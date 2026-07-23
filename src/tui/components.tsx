import { Box, Text } from "ink";
import type { ReactElement } from "react";
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
                <Text>{item.text}</Text>
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

export interface StatusBarProps {
  provider: string;
  model: string;
  sessionId: string;
  busy: boolean;
  frame: number;
}

export function StatusBar({ provider, model, sessionId, busy, frame }: StatusBarProps): ReactElement {
  const state = busy ? `${spinnerFrame(frame)} working` : "ready";
  return (
    <Box>
      <Text dimColor>
        {state} {MIDDOT} {provider}/{model} {MIDDOT} {sessionId.slice(0, 8)} {MIDDOT} ctrl-c interrupt {MIDDOT} /exit
        quit
      </Text>
    </Box>
  );
}
