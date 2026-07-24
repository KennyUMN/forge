import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkills, loadSkillBody, formatSkillsSection } from "../../src/skills/skill-loader.js";

let root: string;
let forgeHome: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forge-skills-"));
  forgeHome = join(root, "forge-home");
  await mkdir(forgeHome, { recursive: true });
  process.env["FORGE_HOME"] = forgeHome;
});

afterEach(async () => {
  delete process.env["FORGE_HOME"];
  await rm(root, { recursive: true, force: true });
});

describe("discoverSkills", () => {
  it("discovers global skills from ~/.forge/skills/", async () => {
    const skillsDir = join(forgeHome, "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, "deploy.md"),
      "---\nname: deploy\ndescription: Deploy the app\n---\nRun deployment steps.",
    );

    const cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });

    const skills = await discoverSkills(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("deploy");
    expect(skills[0]!.description).toBe("Deploy the app");
    expect(skills[0]!.path).toBe(join(skillsDir, "deploy.md"));
  });

  it("discovers project skills from .forge/skills/", async () => {
    const cwd = join(root, "project");
    const skillsDir = join(cwd, ".forge", "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      join(skillsDir, "review.md"),
      "---\nname: review\ndescription: Code review workflow\n---\nReview steps here.",
    );

    const skills = await discoverSkills(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("review");
    expect(skills[0]!.description).toBe("Code review workflow");
  });

  it("returns global skills before project skills", async () => {
    const globalDir = join(forgeHome, "skills");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "alpha.md"), "---\nname: alpha\ndescription: Global skill\n---\nBody.");

    const cwd = join(root, "project");
    const projectDir = join(cwd, ".forge", "skills");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "beta.md"), "---\nname: beta\ndescription: Project skill\n---\nBody.");

    const skills = await discoverSkills(cwd);

    expect(skills).toHaveLength(2);
    expect(skills[0]!.name).toBe("alpha");
    expect(skills[1]!.name).toBe("beta");
  });

  it("uses filename as name when frontmatter has no name", async () => {
    const cwd = join(root, "project");
    const skillsDir = join(cwd, ".forge", "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "my-skill.md"), "---\ndescription: Does stuff\n---\nBody.");

    const skills = await discoverSkills(cwd);

    expect(skills[0]!.name).toBe("my-skill");
    expect(skills[0]!.description).toBe("Does stuff");
  });

  it("uses filename as name and first line as description when no frontmatter", async () => {
    const cwd = join(root, "project");
    const skillsDir = join(cwd, ".forge", "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "plain.md"), "This is the first line\nMore content.");

    const skills = await discoverSkills(cwd);

    expect(skills[0]!.name).toBe("plain");
    expect(skills[0]!.description).toBe("This is the first line");
  });

  it("returns empty array when no skill directories exist", async () => {
    const cwd = join(root, "empty");
    await mkdir(cwd, { recursive: true });

    const skills = await discoverSkills(cwd);

    expect(skills).toEqual([]);
  });

  it("ignores non-.md files", async () => {
    const cwd = join(root, "project");
    const skillsDir = join(cwd, ".forge", "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, "notes.txt"), "not a skill");
    await writeFile(join(skillsDir, "real.md"), "---\nname: real\ndescription: A skill\n---\nBody.");

    const skills = await discoverSkills(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("real");
  });
});

describe("loadSkillBody", () => {
  it("loads the full body from a skill file with frontmatter", async () => {
    const cwd = join(root, "project");
    const skillsDir = join(cwd, ".forge", "skills");
    await mkdir(skillsDir, { recursive: true });
    const filePath = join(skillsDir, "deploy.md");
    await writeFile(filePath, "---\nname: deploy\ndescription: Deploy the app\n---\nStep 1: build\nStep 2: push");

    const skill = await loadSkillBody(filePath);

    expect(skill.name).toBe("deploy");
    expect(skill.description).toBe("Deploy the app");
    expect(skill.body).toBe("Step 1: build\nStep 2: push");
    expect(skill.path).toBe(filePath);
  });

  it("loads body from a file without frontmatter", async () => {
    const cwd = join(root, "project");
    const skillsDir = join(cwd, ".forge", "skills");
    await mkdir(skillsDir, { recursive: true });
    const filePath = join(skillsDir, "plain.md");
    await writeFile(filePath, "First line description\nRest of body.");

    const skill = await loadSkillBody(filePath);

    expect(skill.name).toBe("plain");
    expect(skill.description).toBe("First line description");
    expect(skill.body).toBe("First line description\nRest of body.");
  });

  it("throws for a missing file", async () => {
    await expect(loadSkillBody(join(root, "nonexistent.md"))).rejects.toThrow();
  });
});

describe("formatSkillsSection", () => {
  it("formats skills as a bulleted list", () => {
    const section = formatSkillsSection([
      { name: "deploy", description: "Deploy the app", path: "/a/deploy.md" },
      { name: "review", description: "Code review", path: "/a/review.md" },
    ]);

    expect(section).toContain("## Available Skills");
    expect(section).toContain("- deploy: Deploy the app");
    expect(section).toContain("- review: Code review");
    expect(section).toContain("Use load_skill to access a skill's full content when relevant.");
  });

  it("returns empty string for no skills", () => {
    expect(formatSkillsSection([])).toBe("");
  });
});
