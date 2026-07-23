import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../../src/tui/app.js";
import type { TurnRunner } from "../../src/tui/app.js";

// Deliberately not starting with letters that appear in the assertions below:
// the status bar prints a session prefix, and a short id like "abcdef12" makes
// a substring assertion for typed text pass for the wrong reason.
const BASE_PROPS = { provider: "9router", model: "ComboOP", sessionId: "5f0e9d8c-1234-5678" };

const ENTER = "\r";
const BACKSPACE = "\x7f";
const CTRL_C = "\x03";

const completed = { stoppedReason: "completed" };

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function renderApp(runTurn: TurnRunner) {
  return render(<App {...BASE_PROPS} runTurn={runTurn} />);
}

interface Stdin {
  write: (data: string) => void;
}

// Ink hands useInput one chunk per write, so "text\r" arrives as a single
// input with key.return unset -- the same way a paste does. Anything that must
// be recognised as a key has to be written on its own.
async function type(stdin: Stdin, text: string): Promise<void> {
  stdin.write(text);
  await tick();
}

async function submit(stdin: Stdin, text: string): Promise<void> {
  await type(stdin, text);
  await type(stdin, ENTER);
}

describe("App", () => {
  it("shows the status bar with provider, model and session", () => {
    const { lastFrame } = renderApp(async () => completed);

    expect(lastFrame()).toContain("9router/ComboOP");
    expect(lastFrame()).toContain("5f0e9d8c");
    expect(lastFrame()).toContain("ready");
  });

  it("echoes typed characters into the prompt", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "hello");

    expect(lastFrame()).toContain("hello");
  });

  it("removes the last character on backspace", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "hello");
    await type(stdin, BACKSPACE);

    expect(lastFrame()).toContain("hell");
    expect(lastFrame()).not.toContain("hello");
  });

  it("submits the line on enter and clears the prompt", async () => {
    const runTurn = vi.fn<TurnRunner>(async () => completed);
    const { stdin, lastFrame } = renderApp(runTurn);

    await submit(stdin, "do it");

    expect(runTurn).toHaveBeenCalledOnce();
    expect(runTurn.mock.calls[0][0].text).toBe("do it");
    expect(lastFrame()).toContain("do it");
  });

  it("does not submit a blank line", async () => {
    const runTurn = vi.fn<TurnRunner>(async () => completed);
    const { stdin } = renderApp(runTurn);

    await submit(stdin, "   ");

    expect(runTurn).not.toHaveBeenCalled();
  });

  // The whole reason the event stream exists: a tool a policy auto-allowed
  // used to produce no visible output at all.
  it("renders a tool call and its result from the event stream", async () => {
    const call = { id: "c1", name: "read_file", input: { path: "a.ts" } };
    const { stdin, lastFrame } = renderApp(async ({ onEvent }) => {
      onEvent({ type: "tool_call", call });
      onEvent({ type: "tool_result", call, result: { toolCallId: "c1", output: "file contents", isError: false } });
      return completed;
    });

    await submit(stdin, "read it");

    expect(lastFrame()).toContain("read_file");
    expect(lastFrame()).toContain("file contents");
  });

  it("shows a call as running until its result arrives", async () => {
    const call = { id: "c1", name: "bash", input: { command: "sleep 1" } };
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { stdin, lastFrame } = renderApp(async ({ onEvent }) => {
      onEvent({ type: "tool_call", call });
      await blocked;
      onEvent({ type: "tool_result", call, result: { toolCallId: "c1", output: "finished", isError: false } });
      return completed;
    });

    await submit(stdin, "run it");
    expect(lastFrame()).toContain("running");

    release();
    await tick();
    await tick();

    expect(lastFrame()).toContain("finished");
  });

  it("prompts for permission and denies on n", async () => {
    const call = { id: "c1", name: "bash", input: { command: "rm -rf /" } };
    let approved: boolean | undefined;

    const { stdin, lastFrame } = renderApp(async ({ ask }) => {
      approved = await ask(call);
      return completed;
    });

    await submit(stdin, "go");
    expect(lastFrame()).toContain("Allow bash?");

    await type(stdin, "n");

    expect(approved).toBe(false);
    expect(lastFrame()).not.toContain("Allow bash?");
  });

  it("approves on y", async () => {
    const call = { id: "c1", name: "bash", input: { command: "ls" } };
    let approved: boolean | undefined;

    const { stdin } = renderApp(async ({ ask }) => {
      approved = await ask(call);
      return completed;
    });

    await submit(stdin, "go");
    await type(stdin, "y");

    expect(approved).toBe(true);
  });

  // Ctrl-C interrupts the turn rather than quitting, matching every other
  // agent CLI. Ink's own Ctrl-C handling is disabled for exactly this reason.
  it("aborts the running turn on ctrl-c instead of exiting", async () => {
    let aborted = false;
    const { stdin, lastFrame } = renderApp(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ stoppedReason: "aborted" });
          });
        }),
    );

    await submit(stdin, "go");
    await type(stdin, CTRL_C);

    expect(aborted).toBe(true);
    expect(lastFrame()).toContain("interrupted");
  });

  // Otherwise the spinner on a call that will never resolve runs forever.
  it("settles calls still pending when a turn is interrupted", async () => {
    const call = { id: "c1", name: "bash", input: { command: "sleep 100" } };
    const { stdin, lastFrame } = renderApp(
      ({ onEvent, signal }) =>
        new Promise((resolve) => {
          onEvent({ type: "tool_call", call });
          signal.addEventListener("abort", () => resolve({ stoppedReason: "aborted" }));
        }),
    );

    await submit(stdin, "go");
    expect(lastFrame()).toContain("running");

    await type(stdin, CTRL_C);

    expect(lastFrame()).not.toContain("running");
    expect(lastFrame()).toContain("interrupted");
  });

  it("reports a turn that threw without tearing down the session", async () => {
    const { stdin, lastFrame } = renderApp(async () => {
      throw new Error("provider exploded");
    });

    await submit(stdin, "go");

    expect(lastFrame()).toContain("provider exploded");
    expect(lastFrame()).toContain("ready");
  });

  it("notes when a turn stopped on the step limit", async () => {
    const { stdin, lastFrame } = renderApp(async () => ({ stoppedReason: "max_steps_reached" }));

    await submit(stdin, "go");

    expect(lastFrame()).toContain("max steps reached");
  });

  // Typing during a turn is almost always meant for the next prompt; buffering
  // it would silently submit something the user has forgotten about.
  it("ignores keystrokes while a turn is running", async () => {
    const runTurn = vi.fn<TurnRunner>(() => new Promise(() => {}));
    const { stdin, lastFrame } = renderApp(runTurn);

    await submit(stdin, "first");
    await submit(stdin, "second");

    expect(runTurn).toHaveBeenCalledOnce();
    expect(lastFrame()).not.toContain("second");
  });
});
