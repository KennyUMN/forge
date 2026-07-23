import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeHome } from "./paths.js";
import type { McpServerConfig } from "../mcp/mcp-client.js";
import type { CliOptions } from "./args.js";

export interface ProviderConfig {
  type: "anthropic" | "openrouter" | "openai-compatible";
  model?: string;
  // "openai-compatible" only: the chat-completions endpoint to talk to, e.g.
  // a self-hosted router, Ollama ("http://localhost:11434/v1"), or any vendor
  // exposing OpenAI's dialect. Ignored by the other provider types, which
  // each have exactly one endpoint.
  baseUrl?: string;
  // Name of the environment variable holding the API key, rather than the key
  // itself -- config files get committed, and a key in one is a leaked key.
  // Omit for local runtimes that do not authenticate.
  apiKeyEnv?: string;
  // Label used in logs; defaults per provider type.
  name?: string;
  // TLS for self-hosted endpoints behind a private CA. Prefer caCertPath --
  // it adds one trust anchor; insecureSkipTlsVerify switches verification off
  // for this provider's connections entirely.
  caCertPath?: string;
  insecureSkipTlsVerify?: boolean;
}

export interface ForgeConfig {
  mcpServers: McpServerConfig[];
  provider: ProviderConfig;
}

const CONFIG_FILENAME = "forge.config.json";
const DEFAULT_PROVIDER: ProviderConfig = { type: "anthropic" };

export function globalConfigPath(home?: string): string {
  return join(forgeHome(home), CONFIG_FILENAME);
}

async function readConfigFile(path: string): Promise<Partial<ForgeConfig> | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw) as Partial<ForgeConfig>;
  } catch (err) {
    // A malformed config would otherwise surface as a bare SyntaxError with no
    // indication of which of the two possible files is at fault.
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Resolution order, later winning over earlier: global config, project config,
// command-line flags. Provider fields merge individually rather than the whole
// provider object replacing wholesale, so a project can override just the model
// while keeping the globally configured endpoint and key variable.
export async function loadConfig(cwd: string, options: CliOptions = { command: "run" }, home?: string): Promise<ForgeConfig> {
  const global = await readConfigFile(globalConfigPath(home));
  const project = await readConfigFile(join(cwd, CONFIG_FILENAME));

  const provider: ProviderConfig = {
    ...DEFAULT_PROVIDER,
    ...global?.provider,
    ...project?.provider,
  };

  if (options.providerType) provider.type = options.providerType;
  if (options.model) provider.model = options.model;
  if (options.baseUrl) provider.baseUrl = options.baseUrl;
  if (options.apiKeyEnv) provider.apiKeyEnv = options.apiKeyEnv;
  if (options.caCertPath) provider.caCertPath = options.caCertPath;
  if (options.insecure) provider.insecureSkipTlsVerify = true;

  return {
    // MCP servers are replaced, not concatenated: a project listing its own
    // servers means "these", not "these as well as whatever is configured
    // globally", which would otherwise spawn unexpected subprocesses.
    mcpServers: project?.mcpServers ?? global?.mcpServers ?? [],
    provider,
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set.`);
  }
  return value;
}
