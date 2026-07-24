import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../../src/tui/app.js";
import type { TurnRunner } from "../../src/tui/app.js";

// Deliberately not starting with letters that appear in the assertions below:
// the status bar prints a session prefix, and a short id like "abcdef12" makes
// a substring assertion for typed text pass for the wrong reason.
const BASE_PROPS = {
  version: "0.1.0",
  provider: "9router",
  model: "ComboOP",
  cwd: "/work/forge",
  contextWindow: 200_000,
};

const ENTER = "\r";
const BACKSPACE = "\x7f";
const CTRL_C = "\x03";
// CSI Z: the sequence a terminal sends for shift+tab.
const SHIFT_TAB = "\x1b[Z";

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
  it("shows the banner and status bar", () => {
    const { lastFrame } = renderApp(async () => completed);

    expect(lastFrame()).toContain("Forge 0.1.0");
    expect(lastFrame()).toContain("9router/ComboOP");
    expect(lastFrame()).toContain("[ask]");
  });

  it("cycles the permission mode on shift+tab", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    expect(lastFrame()).toContain("[ask]");
    await type(stdin, SHIFT_TAB);
    expect(lastFrame()).toContain("[accept-edits]");
    await type(stdin, SHIFT_TAB);
    expect(lastFrame()).toContain("[auto]");
    await type(stdin, SHIFT_TAB);
    expect(lastFrame()).toContain("[plan]");
    await type(stdin, SHIFT_TAB);
    expect(lastFrame()).toContain("[ask]");
  });

  it("runs the next turn under the mode showing at the time it starts", async () => {
    const runTurn = vi.fn<TurnRunner>(async () => completed);
    const { stdin } = renderApp(runTurn);

    await type(stdin, SHIFT_TAB);
    await submit(stdin, "go");

    expect(runTurn.mock.calls[0][0].mode).toBe("accept-edits");
  });

  // The whole point of the context bar: a provider that reports nothing must
  // not render as 0% used, which reads as the opposite of the truth.
  it("shows context usage once a step reports it, and says so until then", async () => {
    const { stdin, lastFrame } = renderApp(async ({ onEvent }) => {
      onEvent({
        type: "step_end",
        step: 1,
        finishReason: "completed",
        usage: { inputTokens: 50_000, outputTokens: 120 },
      });
      return completed;
    });

    expect(lastFrame()).toContain("not reported");

    await submit(stdin, "go");

    expect(lastFrame()).toContain("50k/200k");
    expect(lastFrame()).toContain("25%");
  });

  it("toggles the shortcut help with ? only when the prompt is empty", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "?");
    expect(lastFrame()).toContain("cycle permission mode");

    await type(stdin, "?");
    expect(lastFrame()).not.toContain("cycle permission mode");

    // Typed inside a question it is ordinary text, not a shortcut.
    await type(stdin, "what");
    await type(stdin, "?");
    expect(lastFrame()).toContain("what?");
    expect(lastFrame()).not.toContain("cycle permission mode");
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
    // Back to accepting input rather than stuck showing the interrupt hint.
    expect(lastFrame()).toContain("shift+tab cycle mode");
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

describe("App slash commands", () => {
  const SLASH_PROPS = { ...BASE_PROPS, models: ["ComboOP", "gpt-4o"] };

  // Effects that await a callback need an extra microtask flush beyond the
  // single tick submit() does, before the resulting notice reaches the frame.
  async function flush(): Promise<void> {
    await tick();
    await tick();
  }

  it("handles /help locally without sending it to the model", async () => {
    const runTurn = vi.fn<TurnRunner>(async () => completed);
    const { stdin, lastFrame } = render(<App {...SLASH_PROPS} runTurn={runTurn} />);

    await submit(stdin, "/help");

    expect(runTurn).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("commands:");
    expect(lastFrame()).toContain("/usage");
  });

  it("/config shows the active provider and model", async () => {
    const { stdin, lastFrame } = render(<App {...SLASH_PROPS} runTurn={async () => completed} />);

    await submit(stdin, "/config");

    expect(lastFrame()).toContain("provider: 9router");
    expect(lastFrame()).toContain("model:    ComboOP");
  });

  it("/mode sets the permission mode", async () => {
    const { stdin, lastFrame } = render(<App {...SLASH_PROPS} runTurn={async () => completed} />);

    expect(lastFrame()).toContain("[ask]");
    await submit(stdin, "/mode auto");

    expect(lastFrame()).toContain("[auto]");
  });

  it("/model switches the active model via the callback and updates the status bar", async () => {
    const onModelChange = vi.fn(async (m: string) => `model switched to ${m}`);
    const { stdin, lastFrame } = render(
      <App {...SLASH_PROPS} onModelChange={onModelChange} runTurn={async () => completed} />,
    );

    await submit(stdin, "/model gpt-4o");
    await flush();

    expect(onModelChange).toHaveBeenCalledWith("gpt-4o");
    expect(lastFrame()).toContain("9router/gpt-4o");
  });

  it("/compact runs compaction via the callback", async () => {
    const onCompact = vi.fn(async () => "context compacted: 120k -> 60k tokens");
    const { stdin, lastFrame } = render(
      <App {...SLASH_PROPS} onCompact={onCompact} runTurn={async () => completed} />,
    );

    await submit(stdin, "/compact");
    await flush();

    expect(onCompact).toHaveBeenCalled();
    expect(lastFrame()).toContain("120k -> 60k");
  });

  it("/agent delegates the task to the subagent callback", async () => {
    const onAgent = vi.fn(async (task: string) => `subagent done: ${task}`);
    const { stdin, lastFrame } = render(
      <App {...SLASH_PROPS} onAgent={onAgent} runTurn={async () => completed} />,
    );

    await submit(stdin, "/agent write a haiku");
    await flush();

    expect(onAgent.mock.calls[0][0]).toBe("write a haiku");
    expect(lastFrame()).toContain("subagent done: write a haiku");
  });

  it("reports an unavailable capability instead of doing nothing", async () => {
    const { stdin, lastFrame } = render(<App {...SLASH_PROPS} runTurn={async () => completed} />);

    await submit(stdin, "/compact");

    expect(lastFrame()).toContain("not available");
  });
});

describe("App slash autocomplete", () => {
  const UP = "\x1b[A";
  const DOWN = "\x1b[B";
  const TAB = "\t";
  const ESC = "\x1b";

  it("shows the command menu while a slash command is being typed", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "/");

    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).toContain("/usage");
    expect(lastFrame()).toContain("navigate");
  });

  it("filters the menu by the typed prefix", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "/mo");

    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).toContain("/mode");
    expect(lastFrame()).not.toContain("/usage");
  });

  it("moves the highlight with the arrow keys", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "/mo");
    expect(lastFrame()).toContain("› /model");

    await type(stdin, DOWN);
    expect(lastFrame()).toContain("› /mode");

    await type(stdin, UP);
    expect(lastFrame()).toContain("› /model");
  });

  it("completes the highlighted command on tab and closes the menu", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "/mo");
    expect(lastFrame()).toContain("navigate");

    await type(stdin, TAB);

    // The prompt now holds the completed command (the trailing space it adds is
    // trimmed in the rendered frame) and the menu -- its hint line -- is gone.
    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).not.toContain("navigate");
  });

  it("runs the highlighted command on enter without touching the model", async () => {
    const runTurn = vi.fn<TurnRunner>(async () => completed);
    const { stdin, lastFrame } = renderApp(runTurn);

    await type(stdin, "/he");
    await type(stdin, ENTER);

    expect(runTurn).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("commands:");
  });

  it("dismisses the menu on escape", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "/");
    expect(lastFrame()).toContain("navigate");

    stdin.write(ESC);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lastFrame()).not.toContain("navigate");
  });

  it("hides the menu once an argument is being typed", async () => {
    const { stdin, lastFrame } = renderApp(async () => completed);

    await type(stdin, "/model x");

    expect(lastFrame()).not.toContain("navigate");
  });
});
