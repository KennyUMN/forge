import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "../mcp/mcp-client.js";

export interface ProviderConfig {
  type: "anthropic" | "openrouter";
  model?: string;
}

export interface ForgeConfig {
  mcpServers: McpServerConfig[];
  provider: ProviderConfig;
}

const CONFIG_FILENAME = "forge.config.json";
const DEFAULT_PROVIDER: ProviderConfig = { type: "anthropic" };

export async function loadConfig(cwd: string): Promise<ForgeConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: [], provider: DEFAULT_PROVIDER };
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Partial<ForgeConfig>;
  return {
    mcpServers: parsed.mcpServers ?? [],
    provider: parsed.provider ?? DEFAULT_PROVIDER,
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set.`);
  }
  return value;
}
