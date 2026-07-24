import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { forgeHome } from "../cli/paths.js";

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

export interface Skill extends SkillMetadata {
  body: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  body: string;
}

function parseFrontmatter(content: string): Frontmatter {
  if (!content.startsWith("---")) {
    const firstLine = content.split("\n")[0] ?? "";
    return { body: content, description: firstLine };
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    const firstLine = content.split("\n")[0] ?? "";
    return { body: content, description: firstLine };
  }

  const yamlBlock = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");

  const fields: Record<string, string> = {};
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) fields[key] = value;
  }

  return { name: fields["name"], description: fields["description"], body };
}

async function discoverInDir(dir: string): Promise<SkillMetadata[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const results: SkillMetadata[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    const name = fm.name ?? basename(entry, ".md");
    const description = fm.description ?? "";
    results.push({ name, description, path: filePath });
  }
  return results;
}

export async function discoverSkills(cwd: string): Promise<SkillMetadata[]> {
  const globalDir = join(forgeHome(), "skills");
  const projectDir = join(cwd, ".forge", "skills");

  const globalSkills = await discoverInDir(globalDir);
  const projectSkills = await discoverInDir(projectDir);

  return [...globalSkills, ...projectSkills];
}

export async function loadSkillBody(path: string): Promise<Skill> {
  const content = await readFile(path, "utf-8");
  const fm = parseFrontmatter(content);
  const name = fm.name ?? basename(path, ".md");
  const description = fm.description ?? "";
  return { name, description, path, body: fm.body };
}

export function formatSkillsSection(skills: SkillMetadata[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return `\n\n## Available Skills\n${lines.join("\n")}\nUse load_skill to access a skill's full content when relevant.`;
}
