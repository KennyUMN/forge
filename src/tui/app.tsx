import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ReactElement } from "react";
import { PermissionPrompt, StatusBar, ThinkingView, TranscriptView } from "./components.js";
import {
  EMPTY_TRANSCRIPT,
  appendNotice,
  appendUserMessage,
  reduceTranscript,
  settlePendingCalls,
} from "./transcript-model.js";
import type { TranscriptState } from "./transcript-model.js";
import type { TurnEvent } from "../agent/turn-events.js";
import type { ToolCallRequest } from "../types/tool-call.js";

const SPINNER_INTERVAL_MS = 80;
const PROMPT_CHEVRON = "›";

export interface TurnRunnerInput {
  text: string;
  onEvent: (event: TurnEvent) => void;
  signal: AbortSignal;
  ask: (call: ToolCallRequest) => Promise<boolean>;
}

export type TurnRunner = (input: TurnRunnerInput) => Promise<{ stoppedReason: string }>;

export interface AppProps {
  provider: string;
  model: string;
  sessionId: string;
  runTurn: TurnRunner;
}

interface PendingPermission {
  call: ToolCallRequest;
  resolve: (approved: boolean) => void;
}

export function App({ provider, model, sessionId, runTurn }: AppProps): ReactElement {
  const { exit } = useApp();
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [frame, setFrame] = useState(0);
  // A ref, not state: Ctrl-C has to reach the controller for the turn that is
  // actually running, and the keystroke handler closes over whatever value was
  // current when it was created.
  const abortRef = useRef<AbortController | null>(null);

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
          onEvent: (event) => setTranscript((state) => reduceTranscript(state, event)),
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
    if (char && !key.ctrl && !key.meta && !key.escape) {
      setInput((current) => current + char);
    }
  });

  return (
    <Box flexDirection="column">
      <TranscriptView items={transcript.items} frame={frame} />
      <ThinkingView text={transcript.thinking} frame={frame} />
      {pending ? (
        <Box marginTop={1}>
          <PermissionPrompt call={pending.call} />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text bold color={busy ? "gray" : "green"}>
            {PROMPT_CHEVRON}{" "}
          </Text>
          <Text>{input}</Text>
          {!busy && <Text inverse> </Text>}
        </Box>
      )}
      <StatusBar provider={provider} model={model} sessionId={sessionId} busy={busy} frame={frame} />
    </Box>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
