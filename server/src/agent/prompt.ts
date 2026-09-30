import { readText } from "../tree/edit.js";
import type { SkillSummary } from "./builtins/skills.js";

async function optionalText(root: string, rel: string): Promise<string | null> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}

export function buildSkillsSection(skills: readonly SkillSummary[]): string {
  const listing =
    skills.length === 0
      ? "No role-specific skills are available."
      : skills.map((skill) => `- **${skill.name}** — ${skill.description}`).join("\n");
  return [
    "## Available skills",
    "",
    "Use `load_skill` before work that matches one of these procedures. Load references only when needed.",
    listing,
  ].join("\n");
}

export async function buildTutorPrompt(
  root: string,
  set: string,
  anchor?: string,
  skills: readonly SkillSummary[] = [],
): Promise<string> {
  const [profile, plan, curriculum] = await Promise.all([
    readText(root, "_global/profile.md"),
    readText(root, `${set}/PLAN.md`),
    optionalText(root, `${set}/curriculum.md`),
  ]);

  return [
    "You are the Studium Tutor. Help the learner understand this study set and improve its notes when asked.",
    "Use only the tools provided to you. Never use shell commands.",
    "Edit surgically with study_edit; never rewrite whole files. Write only notes and logs.",
    "Cite source-grounded claims as [^src:<id>] and keep LaTeX math in $...$ or $$...$$.",
    "Paths are relative to the current study set.",
    "",
    buildSkillsSection(skills),
    "",
    "## Learner profile",
    profile,
    "",
    "## Study plan",
    plan,
    ...(curriculum === null ? [] : ["", "## Curriculum", curriculum]),
    ...(anchor === undefined ? [] : ["", `The learner is viewing: ${anchor}`]),
  ].join("\n");
}

export async function buildBatchRolePrompt(opts: {
  role: "librarian" | "outliner" | "drafter" | "checker" | "cardsmith" | "critic";
  root: string;
  set: string | null;
  skills: readonly SkillSummary[];
}): Promise<string> {
  const profile = await readText(opts.root, "_global/profile.md");
  const [plan, curriculum] =
    opts.set === null
      ? [null, null]
      : await Promise.all([
          optionalText(opts.root, `${opts.set}/PLAN.md`),
          optionalText(opts.root, `${opts.set}/curriculum.md`),
        ]);
  const roleInstructions = {
    outliner: [
      "You are the Studium Outliner. Propose a study plan and prerequisite-ordered curriculum for the learner.",
      "Write only Markdown proposals under plan-proposals/. Never edit PLAN.md, curriculum.md, notes, or the library.",
      "The learner approves proposals in the Inbox. Propose new sources as URLs; never register them or invent library ids.",
    ],
    librarian: [
      "You are the Studium Librarian. Read source material in library/ and improve only that source's source.md.",
      "Use exact, surgical edits. Do not write notes, plans, cards, or other library files.",
    ],
    drafter: [
      "You are the Studium Drafter. Read the current set and library sources, then create or surgically edit notes only.",
      "Every source-grounded claim needs a [^src:<id>] citation. Mark uncertain claims instead of inventing support.",
    ],
    checker: [
      "You are the Studium Checker. Verify claims against source text and independent references.",
      "Write findings only under log/checks/. Do not edit notes or source material.",
    ],
    cardsmith: [
      "You are the Studium Cardsmith. Draft source-grounded cards for the assigned accepted note.",
      "Use add_card for new cards and edit only the pinned card file when explicitly revising rejected cards.",
    ],
    critic: [
      "You are the Studium Card Critic. Review only assigned cards against the twenty rules and existing deck.",
      "Use review_card for verdicts. Do not rewrite card content, approve cards, or export them.",
    ],
  }[opts.role];

  return [
    ...roleInstructions,
    "Use only the tools provided to you. Never use shell commands.",
    "Set-relative paths omit the set prefix; global sources use library/<source-id>/... paths.",
    "",
    buildSkillsSection(opts.skills),
    "",
    "## Learner profile",
    profile,
    ...(plan === null ? [] : ["", "## Study plan", plan]),
    ...(curriculum === null ? [] : ["", "## Curriculum", curriculum]),
  ].join("\n");
}
