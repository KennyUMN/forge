import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import type { ReactElement } from "react";
import {
  Banner,
  Divider,
  PermissionPrompt,
  StatusBar,
  ThinkingView,
  TranscriptRow,
  TranscriptView,
} from "./components.js";
import {
  EMPTY_TRANSCRIPT,
  appendNotice,
  appendUserMessage,
  reduceTranscript,
  settlePendingCalls,
} from "./transcript-model.js";
import { nextPermissionMode } from "../permission/permission-policies.js";
import type { PermissionMode } from "../permission/permission-policies.js";
import type { TranscriptState } from "./transcript-model.js";
import type { TurnEvent } from "../agent/turn-events.js";
import type { ToolCallRequest } from "../types/tool-call.js";

const SPINNER_INTERVAL_MS = 80;
const PROMPT_CHEVRON = "›";

const SHORTCUTS = [
  "enter      send",
  "shift+tab  cycle permission mode (ask / accept-edits / auto)",
  "ctrl-c     interrupt the running turn, or quit when idle",
  "?          toggle this help (when the prompt is empty)",
  "/exit      quit",
];

export interface TurnRunnerInput {
  text: string;
  mode: PermissionMode;
  onEvent: (event: TurnEvent) => void;
  signal: AbortSignal;
  ask: (call: ToolCallRequest) => Promise<boolean>;
}

export type TurnRunner = (input: TurnRunnerInput) => Promise<{ stoppedReason: string }>;

export interface AppProps {
  version: string;
  provider: string;
  model: string;
  cwd: string;
  branch?: string;
  contextWindow: number;
  initialMode?: PermissionMode;
  runTurn: TurnRunner;
}

interface PendingPermission {
  call: ToolCallRequest;
  resolve: (approved: boolean) => void;
}

export function App({
  version,
  provider,
  model,
  cwd,
  branch,
  contextWindow,
  initialMode = "ask",
  runTurn,
}: AppProps): ReactElement {
  const { exit } = useApp();
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<PermissionMode>(initialMode);
  const [showHelp, setShowHelp] = useState(false);
  // Undefined until a provider reports a count -- shown as unknown rather than
  // as zero, since several compatible servers never report usage at all.
  const [usedTokens, setUsedTokens] = useState<number | undefined>(undefined);
  // How many transcript rows are finished. Everything below this index is
  // handed to <Static>, which writes each row to the terminal exactly once and
  // never repaints it. Without that, Ink redraws the whole conversation on
  // every frame: the scrollback fills with duplicates and the banner is pushed
  // off the top of a long session.
  const [settledCount, setSettledCount] = useState(0);
  // A ref, not state: Ctrl-C has to reach the controller for the turn that is
  // actually running, and the keystroke handler closes over whatever value was
  // current when it was created.
  const abortRef = useRef<AbortController | null>(null);
  // Likewise the mode: a turn reads it when it starts, and the handler that
  // starts it must not see a stale copy from an earlier render.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Ticking only while something is in flight keeps an idle forge from
  // repainting the screen twelve times a second for a spinner nobody is
  // waiting on.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setFrame((current) => current + 1), SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [busy]);

  const ask = useCallback(
    (call: ToolCallRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ call, resolve });
      }),
    [],
  );

  const submit = useCallback(
    async (text: string) => {
      setTranscript((state) => appendUserMessage(state, text));
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await runTurn({
          text,
          mode: modeRef.current,
          onEvent: (event) => {
            // Input tokens are the whole conversation the model just read, so
            // the latest step's count is the current context usage -- not
            // something to accumulate across steps.
            if (event.type === "step_end" && event.usage) setUsedTokens(event.usage.inputTokens);
            setTranscript((state) => reduceTranscript(state, event));
          },
          signal: controller.signal,
          ask,
        });
        if (result.stoppedReason === "max_steps_reached") {
          setTranscript((state) => appendNotice(state, "stopped: max steps reached"));
        } else if (result.stoppedReason === "aborted") {
          setTranscript((state) => appendNotice(settlePendingCalls(state, "interrupted"), "interrupted"));
        }
      } catch (err) {
        const message = controller.signal.aborted ? "interrupted" : `error: ${errorText(err)}`;
        setTranscript((state) => appendNotice(settlePendingCalls(state, message), message));
      } finally {
        // Settled only once the turn is over: rows mutate while it runs (text
        // accumulates, a tool call gains its result), and <Static> would have
        // already printed the half-finished version.
        setTranscript((state) => {
          setSettledCount(state.items.length);
          return state;
        });
        abortRef.current = null;
        // A permission question left open by an interrupted turn would swallow
        // every subsequent keystroke, since the prompt captures input while it
        // is showing.
        setPending((current) => {
          current?.resolve(false);
          return null;
        });
        setBusy(false);
      }
    },
    [runTurn, ask],
  );

  useInput((char, key) => {
    // Ctrl-C interrupts the turn rather than quitting, matching every other
    // agent CLI; it only exits when there is nothing to interrupt.
    if (key.ctrl && char === "c") {
      if (abortRef.current) abortRef.current.abort();
      else exit();
      return;
    }

    // Allowed mid-turn: the mode is read when the *next* turn starts, so
    // changing it while one runs is harmless and saves waiting for it.
    if (key.tab && key.shift) {
      setMode(nextPermissionMode(modeRef.current));
      return;
    }

    if (pending) {
      const answer = char.toLowerCase();
      if (answer === "y" || answer === "n") {
        pending.resolve(answer === "y");
        setPending(null);
      }
      return;
    }

    // Keystrokes during a turn are dropped rather than buffered: text typed
    // while the model is mid-response almost always belongs to the next
    // prompt, and queueing it would silently submit something the user has
    // forgotten they typed.
    if (busy) return;

    if (key.return) {
      const text = input.trim();
      setInput("");
      if (text === "/exit") {
        exit();
        return;
      }
      if (text) void submit(text);
      return;
    }
    if (key.delete || key.backspace) {
      setInput((current) => current.slice(0, -1));
      return;
    }
    // Only when the prompt is empty, so a "?" typed inside a question reaches
    // the model instead of opening the help.
    if (char === "?" && input === "") {
      setShowHelp((current) => !current);
      return;
    }
    if (char && !key.ctrl && !key.meta && !key.escape) {
      setInput((current) => current + char);
    }
  });

  const settled = transcript.items.slice(0, settledCount);
  const live = transcript.items.slice(settledCount);

  return (
    <Box flexDirection="column">
      {/* The banner is the first Static entry rather than a plain element, so
          it scrolls away with the conversation instead of being reprinted at
          the top of every frame. */}
      <Static items={[{ key: "banner" } as const, ...settled.map((item, index) => ({ key: `row-${index}`, item }))]}>
        {(entry) =>
          "item" in entry ? (
            <TranscriptRow key={entry.key} item={entry.item} />
          ) : (
            <Banner key={entry.key} version={version} provider={provider} model={model} cwd={cwd} />
          )
        }
      </Static>
      <TranscriptView items={live} frame={frame} />
      <ThinkingView text={transcript.thinking} frame={frame} />
      {showHelp && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {SHORTCUTS.map((line) => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Divider />
      </Box>
      {pending ? (
        <PermissionPrompt call={pending.call} />
      ) : (
        <Box>
          <Text bold color={busy ? "gray" : "green"}>
            {PROMPT_CHEVRON}{" "}
          </Text>
          <Text>{input}</Text>
          {!busy && <Text inverse> </Text>}
        </Box>
      )}
      <Divider />
      <StatusBar
        mode={mode}
        provider={provider}
        model={model}
        branch={branch}
        usedTokens={usedTokens}
        contextWindow={contextWindow}
        busy={busy}
        frame={frame}
      />
    </Box>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
