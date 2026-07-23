import type { TurnEvent } from "../agent/turn-events.js";
import type { ToolCallRequest } from "../types/tool-call.js";

const MAX_INPUT_CHARS = 90;
const MAX_OUTPUT_LINES = 6;

// Colour is opt-out via the de-facto NO_COLOR convention and is suppressed
// automatically when stdout is not a terminal, so piping forge's output into a
// file or another program yields plain text rather than escape sequences.
function colorEnabled(stream: NodeJS.WriteStream): boolean {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR;
}

function dim(text: string, enabled: boolean): string {
  return enabled ? `\x1b[2m${text}\x1b[0m` : text;
}

function red(text: string, enabled: boolean): string {
  return enabled ? `\x1b[31m${text}\x1b[0m` : text;
}

// Tool inputs are arbitrary model-supplied JSON and a file's full contents can
// come back through them, so both the call line and the result are clipped.
// The session log keeps the untruncated version.
function summariseInput(call: ToolCallRequest): string {
  const json = JSON.stringify(call.input) ?? "";
  return json.length > MAX_INPUT_CHARS ? `${json.slice(0, MAX_INPUT_CHARS)}...` : json;
}

function summariseOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES) return output;
  return [...lines.slice(0, MAX_OUTPUT_LINES), `... ${lines.length - MAX_OUTPUT_LINES} more line(s)`].join("\n");
}

export interface RendererOptions {
  stream?: NodeJS.WriteStream;
  showThinking?: boolean;
}

// Renders a turn's events as plain text. Tracks whether the last thing written
// was assistant text so a tool call can start on its own line without leaving
// a blank one when the model wrote nothing before calling it.
export function createRenderer(options: RendererOptions = {}): (event: TurnEvent) => void {
  const stream = options.stream ?? process.stdout;
  const color = colorEnabled(stream);
  let midLine = false;

  const breakLine = (): void => {
    if (midLine) {
      stream.write("\n");
      midLine = false;
    }
  };

  return (event: TurnEvent): void => {
    switch (event.type) {
      case "text_delta":
        stream.write(event.text);
        midLine = !event.text.endsWith("\n");
        break;
      case "thinking_delta":
        if (options.showThinking) {
          breakLine();
          stream.write(dim(event.text, color));
        }
        break;
      case "tool_call":
        breakLine();
        stream.write(dim(`  ${event.call.name}(${summariseInput(event.call)})\n`, color));
        break;
      case "tool_result": {
        const body = summariseOutput(event.result.output).replace(/\n/g, "\n    ");
        const line = `    ${body}\n`;
        stream.write(event.result.isError ? red(line, color) : dim(line, color));
        break;
      }
      case "step_start":
      case "step_end":
        break;
    }
  };
}
