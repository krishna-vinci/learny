import type { PlanProposal } from "@studium/shared";
import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { parseCurriculum } from "../tree/curriculum.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";

export const SOURCE_ID = /^lib-[a-z0-9][a-z0-9-]*$/;
export const PROPOSAL_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/;

export function validDeadline(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

export function proposalRootPath(root: string, set: string, file: string): string {
  if (!PROPOSAL_FILE.test(file)) throw new Error("invalid proposal filename");
  const rel = `${set}/plan-proposals/${file}`;
  resolveInRoot(root, rel);
  if (canonicalRel(root, rel) !== rel) throw new Error("proposal symlinks are not allowed");
  return rel;
}

/** The skill's two labeled fences are the only content installed on approval. */
export function parsePlanProposal(text: string): PlanProposal {
  const sections = new Map<string, string>();
  const blocks = /^## (PLAN\.md|curriculum\.md)\s*\r?\n\s*(`{3,}|~{3,})(?:markdown|md)?\s*\r?\n([\s\S]*?)^\2\s*$/gm;
  for (const match of text.matchAll(blocks)) {
    const name = match[1];
    if (name === undefined || sections.has(name)) throw new Error("duplicate proposal section");
    sections.set(name, `${(match[3] ?? "").trim()}\n`);
  }
  const plan = sections.get("PLAN.md");
  const curriculum = sections.get("curriculum.md");
  if (plan === undefined || curriculum === undefined)
    throw new Error("proposal must contain PLAN.md and curriculum.md fences");
  const frontmatter = PlanFrontmatter.parse(parseFrontmatter(plan).frontmatter);
  if (
    !frontmatter.title?.trim() ||
    frontmatter.status === undefined ||
    (frontmatter.level !== null &&
      (frontmatter.level === undefined || frontmatter.level < 1 || frontmatter.level > 5)) ||
    frontmatter.deadline === undefined ||
    (frontmatter.deadline !== null && !validDeadline(frontmatter.deadline)) ||
    frontmatter.sources === undefined ||
    frontmatter.sources.some((source) => !SOURCE_ID.test(source)) ||
    frontmatter.next_action === undefined ||
    !/^## Goal\s*$/m.test(plan) ||
    !/^## Scope [—–-] in\s*$/m.test(plan) ||
    !/^## Scope [—–-] out\s*$/m.test(plan)
  )
    throw new Error("invalid proposed PLAN.md");
  const chapters = parseCurriculum(curriculum);
  if (
    chapters.length < 6 ||
    chapters.length > 14 ||
    chapters.some((chapter, index) => chapter.number !== index + 1 || !chapter.scope || !chapter.prerequisites)
  )
    throw new Error("curriculum must have 6–14 numbered chapters with scope and prerequisites");
  const numbers = new Set(chapters.map((chapter) => chapter.number));
  for (const chapter of chapters) {
    if (chapter.prerequisites === "none") continue;
    if (!/^\d{2,}(?:\s*,\s*\d{2,})*$/.test(chapter.prerequisites))
      throw new Error("prerequisites must be none or distinct earlier chapter numbers separated by commas");
    const references = chapter.prerequisites.split(",").map((value) => Number(value.trim()));
    if (
      new Set(references).size !== references.length ||
      references.some((number) => !numbers.has(number) || chapter.number === null || number >= chapter.number)
    )
      throw new Error("prerequisites must reference distinct existing earlier chapters");
  }
  const sourceSection = /^## Sources to add\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm.exec(text)?.[1] ?? "";
  const sourcesToAdd = [...sourceSection.matchAll(/https?:\/\/[^\s<>\])]+/g)].map((match) => match[0]);
  for (const url of sourcesToAdd) new URL(url);
  return {
    plan,
    curriculum,
    sourcesToAdd: [...new Set(sourcesToAdd)],
    chapters: chapters.map((chapter) => ({
      number: chapter.number as number,
      title: chapter.title,
      scope: chapter.scope,
      prerequisites: chapter.prerequisites,
      ticked: chapter.checked,
    })),
  };
}
