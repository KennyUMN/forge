import type { ProviderConfig } from "./config.js";

export type CliCommand = "run" | "update" | "config" | "help" | "version";

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
  autoApprove?: boolean;
  caCertPath?: string;
  insecure?: boolean;
  // undefined means "decide from whether stdin/stdout are a terminal"; the
  // flags force it either way.
  tui?: boolean;
}

// Thrown rather than returned so every caller is forced to handle a bad
// invocation; main() catches it, prints the message plus a usage hint, and
// exits non-zero. Returning a partially-parsed object instead would let a
// typo'd flag silently run with default settings.
export class CliUsageError extends Error {}

const PROVIDER_TYPES: ReadonlySet<string> = new Set(["anthropic", "openrouter", "openai-compatible"]);

const SUBCOMMANDS: ReadonlySet<string> = new Set(["update", "config"]);

export const HELP_TEXT = `forge - agentic coding assistant in your terminal

USAGE
  forge [options]                 start an interactive session
  forge -p "<prompt>"             run one turn, print the result, exit
  forge update                    update forge to the latest commit and rebuild
  forge config                    print the resolved configuration and exit

OPTIONS
  -m, --model <id>                model to use, e.g. ComboOP
      --provider <type>           anthropic | openrouter | openai-compatible
      --base-url <url>            endpoint for openai-compatible providers
      --api-key-env <NAME>        env var holding the API key
  -c, --cwd <dir>                 working directory for tools (default: .)
  -r, --resume <sessionId>        resume a specific session
      --continue                  resume the most recent session
  -p, --print <prompt>            non-interactive: one turn, then exit
      --yes                       auto-approve every tool call (see below)
      --ca-cert <path>            trust an extra CA, for self-hosted endpoints
      --insecure                  skip TLS verification for this provider only
      --tui / --no-tui            force the full-screen UI on or off
                                  (default: on when stdin and stdout are a tty)
  -h, --help                      show this help
  -v, --version                   show the installed version

CONFIGURATION
  Settings are resolved in this order, later winning over earlier:
    1. ~/.forge/forge.config.json  global defaults
    2. ./forge.config.json         per-project overrides
    3. command-line flags

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
      case "-c":
      case "--cwd":
        options.cwd = requireValue(argv, i, arg);
        i++;
        break;
      case "-r":
      case "--resume":
        options.resumeSessionId = requireValue(argv, i, arg);
        i++;
        break;
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
      case "--ca-cert":
        options.caCertPath = requireValue(argv, i, arg);
        i++;
        break;
      case "--insecure":
        options.insecure = true;
        break;
      case "--tui":
        options.tui = true;
        break;
      case "--no-tui":
        options.tui = false;
        break;
      default:
        throw new CliUsageError(`Unknown option "${arg}". Run "forge --help" for usage.`);
    }
  }

  if (options.resumeSessionId && options.continueLatest) {
    throw new CliUsageError("--resume and --continue cannot be used together.");
  }

  return options;
}
