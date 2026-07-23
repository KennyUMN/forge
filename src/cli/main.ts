import { createInterface } from "node:readline/promises";
import { once } from "node:events";
import { isAbsolute, join, resolve } from "node:path";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildToolRegistry } from "./build-registry.js";
import { buildProvider } from "./build-provider.js";
import { globalConfigPath, loadConfig } from "./config.js";
import { createSharedAskFn, questionOrNull } from "./ask-terminal.js";
import { resolveSession } from "./resolve-session.js";
import { CliUsageError, HELP_TEXT, parseCliArgs } from "./args.js";
import { loadEnvFiles } from "./env.js";
import { installRoot, readVersion } from "./install.js";
import { runUpdate } from "./update.js";
import { createRenderer } from "./render.js";
import type { CliOptions } from "./args.js";
import type { ForgeConfig } from "./config.js";

const SYSTEM_PROMPT = "You are Forge, an agentic coding assistant.";

async function printResolvedConfig(cwd: string, config: ForgeConfig, envFiles: string[]): Promise<void> {
  console.log(`forge ${await readVersion()}`);
  console.log(`  install root:  ${installRoot()}`);
  console.log(`  working dir:   ${cwd}`);
  console.log(`  global config: ${globalConfigPath()}`);
  console.log(`  env files:     ${envFiles.length > 0 ? envFiles.join(", ") : "(none loaded)"}`);
  console.log(`  provider:      ${config.provider.type}`);
  console.log(`  model:         ${config.provider.model ?? "(provider default)"}`);
  if (config.provider.baseUrl) console.log(`  base url:      ${config.provider.baseUrl}`);
  if (config.provider.apiKeyEnv) {
    // Report only whether the variable is populated. Printing the key itself
    // would put it into terminal scrollback and shell history transcripts.
    const present = Boolean(process.env[config.provider.apiKeyEnv]);
    console.log(`  api key env:   ${config.provider.apiKeyEnv} (${present ? "set" : "NOT SET"})`);
  }
  console.log(`  mcp servers:   ${config.mcpServers.length}`);
}

export async function main(argv: string[]): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (options.command === "help") {
    console.log(HELP_TEXT);
    return;
  }
  if (options.command === "version") {
    console.log(await readVersion());
    return;
  }
  if (options.command === "update") {
    await runUpdate();
    return;
  }

  // --cwd is resolved against the directory forge was invoked from, so a
  // relative value means what the user typing it expects.
  const cwd = options.cwd ? (isAbsolute(options.cwd) ? options.cwd : resolve(process.cwd(), options.cwd)) : process.cwd();

  const envFiles = loadEnvFiles(cwd);
  const config = await loadConfig(cwd, options);

  if (options.command === "config") {
    await printResolvedConfig(cwd, config, envFiles);
    return;
  }

  const sessionsDir = join(cwd, ".forge", "sessions");
  const session = await resolveSession(sessionsDir, options);

  // buildProvider() must run before buildToolRegistry(): it throws (via
  // requireEnv) if the configured provider's API key env var is missing, and
  // buildToolRegistry() spawns MCP server subprocesses that are only closed
  // in the finally block below. Building the provider first keeps that
  // failure fail-fast, before anything spawns -- ordering them the other way
  // around would leak a spawned MCP subprocess whenever the API key is
  // missing or misnamed.
  const provider = buildProvider(config.provider);
  const registryHandle = await buildToolRegistry(config.mcpServers);

  try {
    if (options.prompt !== undefined) {
      await runOneShot(options, session, provider, registryHandle, cwd);
      return;
    }
    console.log(`Session: ${session.sessionId}`);
    await runInteractive(options, session, provider, registryHandle, cwd);
  } finally {
    await registryHandle.close();
  }
}

type RegistryHandle = Awaited<ReturnType<typeof buildToolRegistry>>;
type Provider = ReturnType<typeof buildProvider>;
type Session = Awaited<ReturnType<typeof resolveSession>>;

// -p/--print has no terminal to prompt in -- it is meant for scripts and pipes,
// where a permission question would hang forever on a closed stdin. Tool calls
// that a policy would ask about are therefore denied unless --yes was passed,
// and the denial travels back to the model as corrective feedback rather than
// killing the run.
async function runOneShot(
  options: CliOptions,
  session: Session,
  provider: Provider,
  registryHandle: RegistryHandle,
  cwd: string,
): Promise<void> {
  const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => options.autoApprove === true);

  const result = await runTurn(options.prompt as string, {
    provider,
    session,
    tools: registryHandle.registry.getAll(),
    gate,
    systemPrompt: SYSTEM_PROMPT,
    toolContext: { cwd },
    // Only assistant text on stdout in one-shot mode: the point of -p is that
    // its output can be piped, and tool chatter would corrupt whatever is
    // reading it.
    onEvent: (event) => {
      if (event.type === "text_delta") process.stdout.write(event.text);
    },
  });

  process.stdout.write("\n");
  if (result.stoppedReason === "max_steps_reached") {
    console.error("(stopped: max steps reached)");
    process.exitCode = 1;
  }
}

async function runInteractive(
  options: CliOptions,
  session: Session,
  provider: Provider,
  registryHandle: RegistryHandle,
  cwd: string,
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // rl.question() never settles if the underlying stdin stream ends while
  // it's pending (Ctrl-D / piped EOF) -- readline's "close" event fires
  // instead, with no way to plumb it through question()'s own promise. Race
  // each question() against this single "close" listener, registered once
  // outside the loop -- re-registering a new once(rl, "close") on every
  // iteration (as an earlier version of this fix did) leaks a "close" and
  // "error" listener pair per turn, which trips Node's
  // MaxListenersExceededWarning in any session with more than ~10 turns.
  // EOF resolves this to null, breaking the loop and reaching the finally
  // block (closing rl and the tool registry) instead of hanging forever --
  // and, whenever an MCP server is configured, orphaning its subprocess.
  const closed = once(rl, "close").then(() => null);

  // Share this single Interface (and its "close" signal) with the permission
  // gate instead of letting it open a second Interface on process.stdin --
  // two independent readline Interfaces on the same input stream corrupts
  // real TTY input (duplicate-echoed keystrokes) and closing either one
  // disables raw mode for the other. Racing against `closed` here too means
  // a permission prompt pending at stdin EOF resolves to "denied" instead of
  // hanging forever the same way the loop's own rl.question() call would.
  const ask = options.autoApprove ? async () => true : createSharedAskFn(rl, closed);
  const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, ask);
  const render = createRenderer();

  try {
    while (true) {
      const userText = await questionOrNull(rl, closed, "> ");
      if (userText === null) break;
      const trimmed = userText.trim();
      if (trimmed.length === 0) continue;
      if (trimmed === "/exit") break;

      // A fresh controller per turn: aborting one turn must not leave every
      // later turn in this session pre-aborted.
      const controller = new AbortController();
      const onSigint = (): void => controller.abort();
      // readline installs its own SIGINT handling for the prompt; adding this
      // listener only for the duration of the turn keeps Ctrl-C at the prompt
      // behaving as it did.
      process.on("SIGINT", onSigint);

      let result;
      try {
        result = await runTurn(userText, {
          provider,
          session,
          tools: registryHandle.registry.getAll(),
          gate,
          systemPrompt: SYSTEM_PROMPT,
          toolContext: { cwd },
          onEvent: render,
          signal: controller.signal,
        });
      } catch (err) {
        // An aborted provider request rejects rather than returning, and an
        // interrupt the user asked for is not an error worth a stack trace.
        if (controller.signal.aborted) {
          process.stdout.write("\n(interrupted)\n");
          continue;
        }
        throw err;
      } finally {
        process.off("SIGINT", onSigint);
      }

      process.stdout.write("\n");
      if (result.stoppedReason === "max_steps_reached") {
        console.log("(stopped: max steps reached)");
      } else if (result.stoppedReason === "aborted") {
        console.log("(interrupted)");
      }
    }
  } finally {
    rl.close();
  }
}
