import { createInterface } from "node:readline/promises";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { PermissionGate } from "../permission/permission-gate.js";
import { DEFAULT_PERMISSION_POLICIES } from "../permission/permission-policies.js";
import { runTurn } from "../agent/turn-orchestrator.js";
import { buildEnvironmentPreamble } from "../agent/preamble.js";
import { buildToolRegistry } from "./build-registry.js";
import { buildProvider, getModelPricing } from "./build-provider.js";
import { discoverMcpServers } from "../mcp/mcp-discovery.js";
import { lookupModel, listModels } from "../provider/model-catalog.js";
import { editStrategyForModel, editStrategyPromptHint } from "../agent/edit-strategy.js";
import { globalConfigPath, loadConfig } from "./config.js";
import { createSharedAskFn, questionOrNull } from "./ask-terminal.js";
import { resolveSession } from "./resolve-session.js";
import { listSessions, getSessionEntries } from "../session/session-manager.js";
import { createCheckpoint, listCheckpoints, rewindToCheckpoint } from "../session/checkpoint.js";
import { exportSessionToHtml } from "../session/export.js";
import { CliUsageError, HELP_TEXT, parseCliArgs } from "./args.js";
import { loadEnvFiles } from "./env.js";
import { installRoot, readVersion } from "./install.js";
import { runUpdate } from "./update.js";
import { createRenderer } from "./render.js";
import { runExec } from "./exec.js";
import { runTui } from "../tui/run.js";
import { loadSteeringFiles, formatSteeringContext } from "../agent/steering.js";
import { discoverSkills, loadSkillBody, formatSkillsSection } from "../skills/skill-loader.js";
import { discoverSlashCommands, expandSlashCommand } from "./slash-commands.js";
import { discoverExtensions } from "../extension/extension-loader.js";
import { createArchitectEditorProvider } from "../agent/architect-editor.js";
import { runSubagent } from "../agent/subagent.js";
import type { SubagentContext } from "../agent/subagent.js";
import type { BudgetConfig } from "../agent/budget.js";
import type { CliOptions } from "./args.js";
import type { ForgeConfig } from "./config.js";
import type { OracleFn, SubagentFn } from "../tool/tool.js";
import type { ModelProvider } from "../provider/model-provider.js";
import type { LspClient } from "../lsp/lsp-client.js";
import type { SlashCommand } from "./slash-commands.js";
import { createTypeScriptLsp } from "../lsp/typescript-lsp.js";

const SYSTEM_PROMPT = "You are Forge, an agentic coding assistant.";

// --tui and --no-tui override; otherwise the full-screen UI is used whenever
// both ends are a real terminal, since it cannot draw into a pipe or read keys
// from a redirected stdin.
function useTui(options: CliOptions): boolean {
  if (options.tui !== undefined) return options.tui;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

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

function printModelCatalog(): void {
  const models = listModels();
  const header = `${"MODEL".padEnd(40)} ${"PROVIDER".padEnd(12)} ${"CONTEXT".padEnd(10)} ${"INPUT $/M".padEnd(10)} ${"OUTPUT $/M".padEnd(11)} CAPABILITIES`;
  console.log(header);
  console.log("-".repeat(header.length + 20));
  for (const m of models) {
    const caps: string[] = [];
    if (m.capabilities.supportsThinking) caps.push("thinking");
    if (m.capabilities.supportsTools) caps.push("tools");
    if (m.capabilities.supportsVision) caps.push("vision");
    const ctx = m.capabilities.contextWindow >= 1_000_000
      ? `${m.capabilities.contextWindow / 1_000_000}M`
      : `${m.capabilities.contextWindow / 1_000}k`;
    const input = `$${m.capabilities.pricePerMillionInput}`;
    const output = `$${m.capabilities.pricePerMillionOutput}`;
    console.log(
      `${m.id.padEnd(40)} ${m.provider.padEnd(12)} ${ctx.padEnd(10)} ${input.padEnd(10)} ${output.padEnd(11)} ${caps.join(", ")}`,
    );
  }
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

  if (options.command === "sessions") {
    const sessions = await listSessions(sessionsDir);
    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }
    for (const s of sessions) {
      const preview = s.firstUserMessage ?? "(no user message)";
      console.log(`${s.id}  ${s.startedAt}  entries: ${s.entryCount}  ${preview}`);
    }
    return;
  }

  if (options.command === "models") {
    printModelCatalog();
    return;
  }

  if (options.command === "rewind") {
    const checkpoints = await listCheckpoints(cwd);
    if (checkpoints.length === 0) {
      console.error("No checkpoints found. Checkpoints are created automatically during tool calls.");
      process.exitCode = 1;
      return;
    }
    const count = options.rewindCount ?? 1;
    if (count > checkpoints.length) {
      console.error(`Only ${checkpoints.length} checkpoint(s) available, cannot rewind ${count} back.`);
      process.exitCode = 1;
      return;
    }
    const target = checkpoints[count - 1];
    await rewindToCheckpoint(cwd, target);
    console.log(`Rewound to checkpoint: ${target.toolName} [${target.entryId}] at ${target.timestamp}`);
    return;
  }

  if (options.command === "export") {
    const sessions = await listSessions(sessionsDir);
    if (sessions.length === 0) {
      console.error("No sessions found.");
      process.exitCode = 1;
      return;
    }
    const sessionId = options.exportSessionId ?? sessions[0].id;
    const entries = await getSessionEntries(sessionsDir, sessionId);
    if (entries.length === 0) {
      console.error(`Session "${sessionId}" not found or empty.`);
      process.exitCode = 1;
      return;
    }
    const outputPath = join(cwd, `forge-session-${sessionId}.html`);
    await exportSessionToHtml(entries, outputPath);
    console.log(`Exported session ${sessionId} to ${outputPath}`);
    return;
  }

  const session = await resolveSession(sessionsDir, options);

  // buildProvider() must run before buildToolRegistry(): it throws (via
  // requireEnv) if the configured provider's API key env var is missing, and
  // buildToolRegistry() spawns MCP server subprocesses that are only closed
  // in the finally block below. Building the provider first keeps that
  // failure fail-fast, before anything spawns -- ordering them the other way
  // around would leak a spawned MCP subprocess whenever the API key is
  // missing or misnamed.
  const baseProvider = buildProvider(config.provider);
  const provider = config.editorProvider
    ? createArchitectEditorProvider({
        architectProvider: baseProvider,
        editorProvider: buildProvider(config.editorProvider),
      })
    : baseProvider;
  const extensions = await discoverExtensions(cwd);
  const registryHandle = await buildToolRegistry(config.mcpServers, extensions);

  if (options.command === "mcp") {
    const { startMcpServer } = await import("../mcp/mcp-server.js");
    await startMcpServer({ provider, tools: registryHandle.registry.getAll(), cwd });
    return;
  }

  let oracle: OracleFn | undefined;
  if (config.oracleProvider) {
    if (config.oracleProvider.model && config.oracleProvider.model === config.provider.model) {
      console.error("Warning: oracleProvider uses the same model as the main provider — cross-model review requires different models.");
    }
    oracle = createOracleFn(buildProvider(config.oracleProvider));
  }

  let lsp: LspClient | undefined;
  if (isBinaryAvailable("typescript-language-server")) {
    try {
      lsp = createTypeScriptLsp();
      await lsp.initialize(cwd);
    } catch {
      lsp = undefined;
    }
  }

  const preamble = await buildEnvironmentPreamble({
    cwd,
    toolNames: [...registryHandle.registry.getAll().keys()],
    maxSteps: config.maxSteps ?? 50,
  });
  const steeringContext = formatSteeringContext(await loadSteeringFiles(cwd));
  const skills = await discoverSkills(cwd);
  const skillsSection = formatSkillsSection(skills);
  const slashCommands = await discoverSlashCommands(cwd);
  const catalogEntry = config.provider.model ? lookupModel(config.provider.model) : undefined;
  const editStrategy = editStrategyForModel(
    config.provider.model ?? "",
    catalogEntry?.capabilities.preferredEditFormat
      ? { default: "structured_diff", perModel: { [config.provider.model!]: catalogEntry.capabilities.preferredEditFormat } }
      : undefined,
  );
  const editHint = editStrategyPromptHint(editStrategy);
  const extensionContext = extensions
    .filter((ext) => ext.contextContent)
    .map((ext) => ext.contextContent)
    .join("\n\n");
  const extensionSection = extensionContext ? `\n\n## Extension context\n${extensionContext}` : "";
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${preamble}${steeringContext}${skillsSection}${extensionSection}\n\n## Edit strategy\n${editHint}`;

  const loadSkill = async (name: string): Promise<string> => {
    const meta = skills.find((s) => s.name === name);
    if (!meta) throw new Error(`no skill named "${name}"`);
    const skill = await loadSkillBody(meta.path);
    return skill.body;
  };

  try {
    if (options.prompt !== undefined) {
      if (options.outputFormat || options.command === "exec") {
        const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => options.autoApprove === true);
        const subagent = createSubagentFn(provider, registryHandle.registry.getAll(), session, gate, systemPrompt, cwd);
        await runExec({
          prompt: options.prompt,
          outputFormat: options.outputFormat ?? "text",
          systemPrompt,
          provider,
          session,
          tools: registryHandle.registry.getAll(),
          gate,
          toolContext: { cwd, oracle, subagent, loadSkill, lsp },
          budget: buildBudgetConfig(options, config.provider.model),
        });
      } else {
        await runOneShot(options, session, provider, registryHandle, cwd, systemPrompt, config.provider.model, oracle, loadSkill, lsp);
      }
      return;
    }
    // The full-screen UI needs a real terminal to draw in and keys to read.
    // Piped or redirected input falls back to the line-based loop, which is
    // also what the test suite drives.
    if (useTui(options)) {
      await runTui({
        provider,
        session,
        tools: registryHandle.registry.getAll(),
        cwd,
        systemPrompt,
        model: config.provider.model ?? "(default)",
        version: await readVersion(),
        contextWindow: config.provider.contextWindow,
        autoApprove: options.autoApprove,
        permissionMode: options.permissionMode,
        oracle,
        lsp,
        models: listModels().map((m) => m.id),
        // /model rebuilds the base provider with the chosen model. A configured
        // architect/editor composite collapses to that single model on switch.
        buildProviderForModel: (model) => buildProvider({ ...config.provider, model }),
      });
      return;
    }

    console.log(`Session: ${session.sessionId}`);
    await runInteractive(options, session, provider, registryHandle, cwd, systemPrompt, config.provider.model, oracle, loadSkill, slashCommands, lsp);
  } finally {
    await registryHandle.close();
    if (lsp) await lsp.shutdown().catch(() => {});
  }
}

type RegistryHandle = Awaited<ReturnType<typeof buildToolRegistry>>;
type Provider = ReturnType<typeof buildProvider>;
type Session = Awaited<ReturnType<typeof resolveSession>>;

function isBinaryAvailable(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function buildBudgetConfig(options: CliOptions, model?: string): BudgetConfig | undefined {
  if (options.maxTokens === undefined && options.maxBudgetUsd === undefined) return undefined;
  const pricing = getModelPricing(model);
  return {
    maxTotalTokens: options.maxTokens,
    maxBudgetUsd: options.maxBudgetUsd,
    ...(pricing ?? {}),
  };
}

function createOracleFn(provider: ModelProvider): OracleFn {
  return async (prompt: string): Promise<string> => {
    let text = "";
    const stream = provider.stream({
      systemPrompt: "",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    for await (const event of stream) {
      if (event.type === "text_delta") {
        text += event.text;
      }
    }
    return text;
  };
}

function createSubagentFn(
  provider: ModelProvider,
  tools: ReadonlyMap<string, import("../tool/tool.js").Tool>,
  session: Session,
  gate: PermissionGate,
  systemPrompt: string,
  cwd: string,
): SubagentFn {
  return async (task, config) => {
    const context: SubagentContext = {
      parentProvider: provider,
      parentTools: tools,
      parentSession: session,
      parentGate: gate,
      systemPrompt,
      cwd,
    };
    return runSubagent(task, config, context);
  };
}

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
  systemPrompt: string,
  model?: string,
  oracle?: OracleFn,
  loadSkill?: (name: string) => Promise<string>,
  lsp?: LspClient,
): Promise<void> {
  const gate = new PermissionGate(DEFAULT_PERMISSION_POLICIES, async () => options.autoApprove === true);
  const subagent = createSubagentFn(provider, registryHandle.registry.getAll(), session, gate, systemPrompt, cwd);

  const result = await runTurn(options.prompt as string, {
    provider,
    session,
    tools: registryHandle.registry.getAll(),
    gate,
    systemPrompt,
    toolContext: { cwd, oracle, subagent, loadSkill, lsp },
    budget: buildBudgetConfig(options, model),
    checkpoint: async (toolName, entryId) => {
      await createCheckpoint(cwd, session.sessionId, entryId, toolName);
    },
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
  } else if (result.stoppedReason === "budget_exceeded") {
    console.error("(stopped: budget exceeded)");
    process.exitCode = 1;
  }
}

async function runInteractive(
  options: CliOptions,
  session: Session,
  provider: Provider,
  registryHandle: RegistryHandle,
  cwd: string,
  systemPrompt: string,
  model?: string,
  oracle?: OracleFn,
  loadSkill?: (name: string) => Promise<string>,
  slashCommands?: SlashCommand[],
  lsp?: LspClient,
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
  const subagent = createSubagentFn(provider, registryHandle.registry.getAll(), session, gate, systemPrompt, cwd);
  const render = createRenderer();

  try {
    while (true) {
      const userText = await questionOrNull(rl, closed, "> ");
      if (userText === null) break;
      const trimmed = userText.trim();
      if (trimmed.length === 0) continue;
      if (trimmed === "/exit") break;

      let promptText = userText;
      if (trimmed.startsWith("/") && slashCommands && slashCommands.length > 0) {
        promptText = await expandSlashCommand(trimmed, slashCommands, cwd);
      }

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
        result = await runTurn(promptText, {
          provider,
          session,
          tools: registryHandle.registry.getAll(),
          gate,
          systemPrompt,
          toolContext: { cwd, oracle, subagent, loadSkill, lsp },
          budget: buildBudgetConfig(options, model),
          checkpoint: async (toolName, entryId) => {
            await createCheckpoint(cwd, session.sessionId, entryId, toolName);
          },
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
      } else if (result.stoppedReason === "budget_exceeded") {
        console.log("(stopped: budget exceeded)");
      }
    }
  } finally {
    rl.close();
  }
}
