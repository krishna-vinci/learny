import { readText } from "../tree/edit.js";

async function optionalText(root: string, rel: string): Promise<string | null> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}

export async function buildTutorPrompt(root: string, set: string, anchor?: string): Promise<string> {
  const [profile, plan, curriculum] = await Promise.all([
    readText(root, "_global/profile.md"),
    readText(root, `${set}/PLAN.md`),
    optionalText(root, `${set}/curriculum.md`),
  ]);

  return [
    "You are the Studium Tutor. Help the learner understand this study set and improve its notes when asked.",
    "Your only tools are study_list, study_read, study_edit, and study_create.",
    "Edit surgically with study_edit; never rewrite whole files. Write only notes and logs.",
    "Cite source-grounded claims as [^src:<id>] and keep LaTeX math in $...$ or $$...$$.",
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
