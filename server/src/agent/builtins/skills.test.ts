import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSkills, skillTools } from "./skills.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-skills-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeSkill(name: string, description = `${name} procedure`) {
  await fs.mkdir(path.join(root, "_global/skills", name, "references"), { recursive: true });
  await fs.writeFile(
    path.join(root, "_global/skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

function tool(name: string, allowed = ["alpha"] as string[]) {
  const found = skillTools(root, allowed).find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`missing tool ${name}`);
  return found;
}

async function execute(name: string, params: Record<string, unknown>, allowed = ["alpha"] as string[]) {
  return tool(name, allowed).execute("call-1", params, undefined, undefined, undefined as never);
}

describe("skillTools", () => {
  it("lists only allowed skills with valid metadata", async () => {
    await writeSkill("alpha");
    await writeSkill("beta");

    await expect(listSkills(root, ["alpha"])).resolves.toEqual([{ name: "alpha", description: "alpha procedure" }]);
  });

  it("loads a skill and lists nested references", async () => {
    await writeSkill("alpha");
    await fs.mkdir(path.join(root, "_global/skills/alpha/references/examples"), { recursive: true });
    await fs.writeFile(path.join(root, "_global/skills/alpha/references/examples/table.md"), "Example table\n");

    const outcome = await execute("load_skill", { name: "alpha" });

    expect(outcome.details).toMatchObject({ isError: false, summary: "loaded skill alpha", skill: "alpha" });
    const text = outcome.content[0]?.type === "text" ? outcome.content[0].text : "";
    expect(text).toContain("# alpha");
    expect(text).toContain("- examples/table.md");
  });

  it("loads a reference inside the allowed skill directory", async () => {
    await writeSkill("alpha");
    await fs.writeFile(path.join(root, "_global/skills/alpha/references/rubric.md"), "Blocker\nMajor\nMinor\n");

    const outcome = await execute("load_skill_reference", { name: "alpha", file: "rubric.md" });

    expect(outcome.details).toMatchObject({ isError: false, summary: "loaded alpha reference rubric.md" });
    expect(outcome.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Blocker") });
  });

  it("rejects skills outside the allowlist and paths that escape references", async () => {
    await writeSkill("alpha");
    await writeSkill("beta");

    const denied = await execute("load_skill", { name: "beta" });
    const traversal = await execute("load_skill_reference", {
      name: "alpha",
      file: "../../../_global/config.yaml",
    });

    expect(denied.details).toMatchObject({ isError: true, summary: "Skill is not available: beta" });
    expect(traversal.details).toMatchObject({ isError: true, summary: expect.stringContaining("relative") });
  });

  it("rejects a symlink reference that escapes the study root", async () => {
    await writeSkill("alpha");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-outside-"));
    await fs.writeFile(path.join(outside, "secret.md"), "secret");
    await fs.symlink(outside, path.join(root, "_global/skills/alpha/references/outside"));

    const outcome = await execute("load_skill_reference", { name: "alpha", file: "outside/secret.md" });

    expect(outcome.details).toMatchObject({
      isError: true,
      summary: expect.stringContaining("Path escapes study root"),
    });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("rejects a references symlink to another directory inside the study root", async () => {
    await writeSkill("alpha");
    const references = path.join(root, "_global/skills/alpha/references");
    const other = path.join(root, "_global/other-references");
    await fs.rm(references, { recursive: true });
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(path.join(other, "secret.md"), "secret");
    await fs.symlink(other, references);

    const outcome = await execute("load_skill_reference", { name: "alpha", file: "secret.md" });

    expect(outcome.details).toMatchObject({
      isError: true,
      summary: expect.stringContaining("outside the skill's references directory"),
    });
    expect(outcome.content[0]).not.toMatchObject({ text: expect.stringContaining("secret") });
  });
});
