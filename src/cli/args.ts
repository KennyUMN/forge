import type { ProviderConfig } from "./config.js";
import type { PermissionMode } from "../permission/permission-policies.js";

export type CliCommand = "run" | "exec" | "update" | "config" | "sessions" | "models" | "rewind" | "undo" | "export" | "mcp" | "help" | "version";

export type OutputFormat = "text" | "json" | "stream-json";

export interface CliOptions {
  command: CliCommand;
  resumeSessionId?: string;
  continueLatest?: boolean;
  model?: string;
  providerType?: ProviderConfig["type"];
  baseUrl?: string;
  apiKeyEnv?: string;
  cwd?: string;
  // Set by -p/--print: run exactly one turn with this text and exit, instead of
  // entering the interactive loop. Makes forge usable in scripts and pipes.
  prompt?: string;
  outputFormat?: OutputFormat;
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
  caCertPath?: string;
  insecure?: boolean;
  maxTokens?: number;
  maxBudgetUsd?: number;
  // Named config profile to activate from the config file's "profiles" map.
  profile?: string;
  // Inline -c key=value overrides, applied at the same level as CLI flags.
  configOverrides?: string[];
  // undefined means "decide from whether stdin/stdout are a terminal"; the
  // flags force it either way.
  tui?: boolean;
  reasoning?: "low" | "medium" | "high";
  reasoningSandwich?: boolean;
  rewindCount?: number;
  exportSessionId?: string;
}

// Thrown rather than returned so every caller is forced to handle a bad
// invocation; main() catches it, prints the message plus a usage hint, and
// exits non-zero. Returning a partially-parsed object instead would let a
// typo'd flag silently run with default settings.
export class CliUsageError extends Error {}

const PROVIDER_TYPES: ReadonlySet<string> = new Set(["anthropic", "openrouter", "openai-compatible"]);

const PERMISSION_MODE_VALUES: ReadonlySet<string> = new Set(["plan", "ask", "accept-edits", "auto"]);

const OUTPUT_FORMAT_VALUES: ReadonlySet<string> = new Set(["text", "json", "stream-json"]);

const REASONING_LEVEL_VALUES: ReadonlySet<string> = new Set(["low", "medium", "high"]);

const SUBCOMMANDS: ReadonlySet<string> = new Set(["update", "config", "exec", "sessions", "models", "rewind", "undo", "export", "mcp"]);

export const HELP_TEXT = `forge - agentic coding assistant in your terminal

USAGE
  forge [options]                 start an interactive session
  forge -p "<prompt>"             run one turn, print the result, exit
  forge exec "<prompt>"           headless exec mode (alias for -p with --output-format)
  forge sessions                  list previous sessions
  forge models                    list available models from the catalog
  forge rewind [n]                rewind to the most recent checkpoint (or n back)
  forge undo                      alias for "forge rewind 1"
  forge export [session-id]       export a session to HTML
  forge mcp                       start Forge as an MCP server on stdio
  forge update                    update forge to the latest commit and rebuild
  forge config                    print the resolved configuration and exit

OPTIONS
  -m, --model <id>                model to use, e.g. ComboOP
      --provider <type>           anthropic | openrouter | openai-compatible
      --base-url <url>            endpoint for openai-compatible providers
      --api-key-env <NAME>        env var holding the API key
      --cwd <dir>                 working directory for tools (default: .)
      --profile <name>            activate a named profile from the config file
  -c, --config <key=value>        inline config override, e.g. -c provider.model=gpt-4o
                                  (repeatable; dot notation for nested keys)
  -r, --resume <sessionId>        resume a specific session
      --continue                  resume the most recent session
  -p, --print <prompt>            non-interactive: one turn, then exit
      --output-format <format>    text | json | stream-json (default: text)
      --yes                       auto-approve every tool call (see below)
      --permission-mode <mode>    plan | ask | accept-edits | auto
      --ca-cert <path>            trust an extra CA, for self-hosted endpoints
      --insecure                  skip TLS verification for this provider only
      --max-tokens <N>            stop turn after N total tokens (input + output)
      --max-budget <N>            stop turn after estimated cost exceeds $N
      --reasoning <level>         uniform thinking budget: low | medium | high
      --reasoning-sandwich        enable per-step reasoning dial (default: on)
      --no-reasoning-sandwich     disable per-step reasoning dial
      --tui / --no-tui            force the full-screen UI on or off
                                  (default: on when stdin and stdout are a tty)
  -h, --help                      show this help
  -v, --version                   show the installed version

CONFIGURATION
  Settings are resolved in this order, later winning over earlier:
    1. ~/.forge/forge.config.json  global defaults
    2. ./forge.config.json         per-project overrides
    3. the active --profile        a named preset from the config file
    4. -c key=value overrides      inline config overrides
    5. command-line flags

  Set FORGE_HOME to use a directory other than ~/.forge.

  API keys are read from environment variables, never from config files.
  forge loads ~/.forge/.env and ./.env at startup, so a key can live in
  ~/.forge/.env and stay out of any repository.

  --yes disables every permission prompt, including the ones guarding
  bash and file writes. Use it only for non-interactive runs whose
  working directory you are willing to let the model modify unattended.

EXAMPLES
  forge
  forge -m ComboOP -p "explain src/agent/turn-orchestrator.ts"
  forge --base-url https://9router.home/v1 --provider openai-compatible
  forge --continue
  forge update
`;

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  // A following flag is never a value -- catches "forge --model --resume abc",
  // which would otherwise silently set model to "--resume".
  if (value === undefined || value.startsWith("-")) {
    throw new CliUsageError(`${flag} requires a value.`);
  }
  return value;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { command: "run" };

  // A subcommand is only recognised in first position, so "forge -p 'run the
  // update script'" stays a prompt rather than becoming the update command.
  if (argv.length > 0 && SUBCOMMANDS.has(argv[0])) {
    options.command = argv[0] as CliCommand;
  }

  if (options.command === "undo") {
    options.command = "rewind";
    options.rewindCount = 1;
  }

  for (let i = options.command === "run" ? 0 : 1; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        return { command: "help" };
      case "-v":
      case "--version":
        return { command: "version" };
      case "-m":
      case "--model":
        options.model = requireValue(argv, i, arg);
        i++;
        break;
      case "--provider": {
        const value = requireValue(argv, i, arg);
        if (!PROVIDER_TYPES.has(value)) {
          throw new CliUsageError(
            `Unknown provider type "${value}". Expected one of: ${[...PROVIDER_TYPES].join(", ")}.`,
          );
        }
        options.providerType = value as ProviderConfig["type"];
        i++;
        break;
      }
      case "--base-url":
        options.baseUrl = requireValue(argv, i, arg);
        i++;
        break;
      case "--api-key-env":
        options.apiKeyEnv = requireValue(argv, i, arg);
        i++;
        break;
      case "--cwd":
        options.cwd = requireValue(argv, i, arg);
        i++;
        break;
      case "--profile":
        options.profile = requireValue(argv, i, arg);
        i++;
        break;
      case "-c":
      case "--config": {
        const value = requireValue(argv, i, arg);
        (options.configOverrides ??= []).push(value);
        i++;
        break;
      }
      case "-r":
      case "--resume": {
        const value = requireValue(argv, i, arg);
        if (value === "last") {
          options.continueLatest = true;
        } else {
          options.resumeSessionId = value;
        }
        i++;
        break;
      }
      case "--continue":
        options.continueLatest = true;
        break;
      case "-p":
      case "--print":
        options.prompt = requireValue(argv, i, arg);
        i++;
        break;
      case "--yes":
        options.autoApprove = true;
        break;
      case "--permission-mode": {
        const value = requireValue(argv, i, arg);
        if (!PERMISSION_MODE_VALUES.has(value)) {
          throw new CliUsageError(
            `Unknown permission mode "${value}". Expected one of: ${[...PERMISSION_MODE_VALUES].join(", ")}.`,
          );
        }
        options.permissionMode = value as PermissionMode;
        i++;
        break;
      }
      case "--ca-cert":
        options.caCertPath = requireValue(argv, i, arg);
        i++;
        break;
      case "--insecure":
        options.insecure = true;
        break;
      case "--max-tokens": {
        const raw = requireValue(argv, i, arg);
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          throw new CliUsageError(`--max-tokens requires a positive number, got "${raw}".`);
        }
        options.maxTokens = n;
        i++;
        break;
      }
      case "--max-budget": {
        const raw = requireValue(argv, i, arg);
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          throw new CliUsageError(`--max-budget requires a positive number, got "${raw}".`);
        }
        options.maxBudgetUsd = n;
        i++;
        break;
      }
      case "--tui":
        options.tui = true;
        break;
      case "--no-tui":
        options.tui = false;
        break;
      case "--output-format": {
        const value = requireValue(argv, i, arg);
        if (!OUTPUT_FORMAT_VALUES.has(value)) {
          throw new CliUsageError(
            `Unknown output format "${value}". Expected one of: ${[...OUTPUT_FORMAT_VALUES].join(", ")}.`,
          );
        }
        options.outputFormat = value as OutputFormat;
        i++;
        break;
      }
      case "--reasoning": {
        const value = requireValue(argv, i, arg);
        if (!REASONING_LEVEL_VALUES.has(value)) {
          throw new CliUsageError(
            `Unknown reasoning level "${value}". Expected one of: ${[...REASONING_LEVEL_VALUES].join(", ")}.`,
          );
        }
        options.reasoning = value as "low" | "medium" | "high";
        i++;
        break;
      }
      case "--reasoning-sandwich":
        options.reasoningSandwich = true;
        break;
      case "--no-reasoning-sandwich":
        options.reasoningSandwich = false;
        break;
      default:
        if (options.command === "exec" && !arg.startsWith("-")) {
          options.prompt = options.prompt ? `${options.prompt} ${arg}` : arg;
        } else if (options.command === "rewind" && !arg.startsWith("-")) {
          const n = Number(arg);
          if (!Number.isInteger(n) || n < 1) {
            throw new CliUsageError(`rewind count must be a positive integer, got "${arg}".`);
          }
          options.rewindCount = n;
        } else if (options.command === "export" && !arg.startsWith("-")) {
          options.exportSessionId = arg;
        } else {
          throw new CliUsageError(`Unknown option "${arg}". Run "forge --help" for usage.`);
        }
    }
  }

  if (options.resumeSessionId && options.continueLatest) {
    throw new CliUsageError("--resume and --continue cannot be used together.");
  }

  return options;
}
