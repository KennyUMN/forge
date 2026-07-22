import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "../mcp/mcp-client.js";

export interface ForgeConfig {
  mcpServers: McpServerConfig[];
}

const CONFIG_FILENAME = "forge.config.json";

export async function loadConfig(cwd: string): Promise<ForgeConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: [] };
    }
    throw err;
  }

  const parsed = JSON.parse(raw) as Partial<ForgeConfig>;
  return { mcpServers: parsed.mcpServers ?? [] };
}

export function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set.");
  }
  return apiKey;
}
