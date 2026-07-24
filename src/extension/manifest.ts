import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExtensionManifest {
  name: string;
  version: string;
  description?: string;
  tools?: string[];
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  context?: string;
  commands?: string[];
}

const MANIFEST_FILENAME = "forge.extension.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function validateManifest(manifest: unknown): manifest is ExtensionManifest {
  if (!isPlainObject(manifest)) return false;
  if (typeof manifest.name !== "string") return false;
  if (typeof manifest.version !== "string") return false;

  if (manifest.description !== undefined && typeof manifest.description !== "string") return false;
  if (manifest.tools !== undefined && !isStringArray(manifest.tools)) return false;
  if (manifest.context !== undefined && typeof manifest.context !== "string") return false;
  if (manifest.commands !== undefined && !isStringArray(manifest.commands)) return false;

  if (manifest.mcpServers !== undefined) {
    if (!isPlainObject(manifest.mcpServers)) return false;
    for (const server of Object.values(manifest.mcpServers)) {
      if (!isPlainObject(server)) return false;
      if (typeof server.command !== "string") return false;
      if (server.args !== undefined && !isStringArray(server.args)) return false;
    }
  }

  return true;
}

export async function loadManifest(extensionDir: string): Promise<ExtensionManifest> {
  const manifestPath = join(extensionDir, MANIFEST_FILENAME);
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Extension manifest not found: ${manifestPath}`);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!validateManifest(parsed)) {
    throw new Error(`${manifestPath} contains an invalid extension manifest.`);
  }

  return parsed;
}
