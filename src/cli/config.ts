import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeHome } from "./paths.js";
import type { McpServerConfig } from "../mcp/mcp-client.js";
import type { ThinkingEffort } from "../types/message.js";
import type { CliOptions } from "./args.js";

export interface ProviderConfig {
  type: "anthropic" | "openrouter" | "openai-compatible";
  model?: string;
  // Extended-thinking effort for providers that support it; ignored by those
  // that do not. Selectable per profile so a "deep" preset can raise it.
  thinking?: ThinkingEffort;
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
  // Denominator for the context-usage indicator. Model metadata forge has no
  // catalogue for, so it is configured rather than inferred; omitted means the
  // UI falls back to a conservative default.
  contextWindow?: number;
}

export interface ForgeConfig {
  mcpServers: McpServerConfig[];
  provider: ProviderConfig;
  oracleProvider?: ProviderConfig;
  editorProvider?: ProviderConfig;
  maxSteps?: number;
  profiles?: { [name: string]: ConfigOverlay };
}

// A config layer that overlays onto a base: every field is optional, and the
// provider objects are themselves partial so a profile or -c override can pin
// just the model while inheriting the base's endpoint and key variable. This is
// what mergeConfig, applyProfile, and the profiles map actually accept -- the
// fully-resolved ForgeConfig requires a provider.type, an overlay does not.
export type ConfigOverlay = Omit<Partial<ForgeConfig>, "provider" | "oracleProvider" | "editorProvider" | "profiles"> & {
  provider?: Partial<ProviderConfig>;
  oracleProvider?: Partial<ProviderConfig>;
  editorProvider?: Partial<ProviderConfig>;
  profiles?: { [name: string]: ConfigOverlay };
};

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Deep merge where the overlay wins field by field: nested objects (provider,
// oracleProvider) merge recursively so an overlay can pin just the model while
// inheriting the base's endpoint and key variable, but arrays (mcpServers)
// replace wholesale -- a layer listing servers means "these", not "these plus
// whatever was configured below", which would otherwise spawn subprocesses the
// overriding layer never asked for. Inputs are never mutated.
export function mergeConfig(base: ConfigOverlay, overlay: ConfigOverlay): ForgeConfig {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = { ...existing, ...value };
    } else {
      result[key] = value;
    }
  }
  return result as unknown as ForgeConfig;
}

// Overlay a named profile onto the config. A profile is a partial config, so it
// only overrides the fields it specifies. An unknown name is an error that lists
// the profiles actually defined, since a typo'd --profile should fail loudly
// rather than silently run with no preset applied.
export function applyProfile(config: ForgeConfig, profileName: string): ForgeConfig {
  if (!profileName) return config;
  const profiles = config.profiles;
  const profile = profiles?.[profileName];
  if (!profile) {
    const available = profiles ? Object.keys(profiles) : [];
    const list = available.length > 0 ? available.join(", ") : "(none)";
    throw new Error(`Unknown profile "${profileName}". Available profiles: ${list}.`);
  }
  return mergeConfig(config, profile);
}

function coerceValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

// Apply -c key=value overrides, each at the same level as a CLI flag. Keys use
// dot notation for nesting (provider.model); values are coerced to boolean or
// number where they look like one, else kept as strings. Later overrides win.
export function applyOverrides(config: ForgeConfig, overrides: string[]): ForgeConfig {
  let result = config;
  for (const override of overrides) {
    const eq = override.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid config override "${override}". Expected key=value (e.g. provider.model=gpt-4o).`);
    }
    const path = override.slice(0, eq).split(".");
    const value = coerceValue(override.slice(eq + 1));
    const overlay: Record<string, unknown> = {};
    let cursor = overlay;
    for (let i = 0; i < path.length - 1; i++) {
      const next: Record<string, unknown> = {};
      cursor[path[i]] = next;
      cursor = next;
    }
    cursor[path[path.length - 1]] = value;
    result = mergeConfig(result, overlay as ConfigOverlay);
  }
  return result;
}

// Resolution order, later winning over earlier: defaults, global config,
// project config, the selected profile, -c overrides, then command-line flags.
// Provider fields merge individually rather than the whole provider object
// replacing wholesale, so a project can override just the model while keeping
// the globally configured endpoint and key variable.
export async function loadConfig(cwd: string, options: CliOptions = { command: "run" }, home?: string): Promise<ForgeConfig> {
  const global = await readConfigFile(globalConfigPath(home));
  const project = await readConfigFile(join(cwd, CONFIG_FILENAME));

  let config = mergeConfig({ provider: DEFAULT_PROVIDER }, global ?? {});
  config = mergeConfig(config, project ?? {});
  config = applyProfile(config, options.profile ?? "");
  config = applyOverrides(config, options.configOverrides ?? []);

  const provider: ProviderConfig = { ...config.provider };
  if (options.providerType) provider.type = options.providerType;
  if (options.model) provider.model = options.model;
  if (options.baseUrl) provider.baseUrl = options.baseUrl;
  if (options.apiKeyEnv) provider.apiKeyEnv = options.apiKeyEnv;
  if (options.caCertPath) provider.caCertPath = options.caCertPath;
  if (options.insecure) provider.insecureSkipTlsVerify = true;

  // The profiles map is a definition source, not runtime config, so it does not
  // travel on into the resolved config the rest of the program consumes.
  const { profiles: _profiles, ...rest } = config;

  return {
    ...rest,
    mcpServers: config.mcpServers ?? [],
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
