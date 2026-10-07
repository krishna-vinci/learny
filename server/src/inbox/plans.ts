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
    chapters.length < 1 ||
    chapters.length > 100 ||
    chapters.some((chapter, index) => chapter.number !== index + 1 || !chapter.scope || !chapter.prerequisites)
  )
    throw new Error("curriculum must have 1–100 numbered chapters with scope and prerequisites");
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
      ...(chapter.images?.length ? { images: chapter.images } : {}),
      ...(chapter.visuals.length ? { visuals: chapter.visuals } : {}),
      ...(chapter.video ? { video: chapter.video } : {}),
    })),
  };
}

/** Replace only the labelled curriculum fence; retain the plan, source list and explanation. */
export function replaceProposalCurriculum(text: string, curriculum: string): string {
  let found = false;
  const updated = text.replace(
    /(^## curriculum\.md\s*\r?\n\s*(`{3,}|~{3,})(?:markdown|md)?\s*\r?\n)([\s\S]*?)(^\2\s*$)/gm,
    (_match, opening: string, _fence: string, _content: string, closing: string) => {
      found = true;
      return `${opening}${curriculum.replace(/\r?\n?$/, "\n")}${closing}`;
    },
  );
  if (!found) throw new Error("Proposal has no curriculum fence");
  parsePlanProposal(updated);
  return updated;
}

const ORIGINS = /<!-- studium-chapter-origins: ([A-Za-z0-9+/=]+) -->/;

/** Learner edits carry provenance in the proposal itself, so renaming and scope edits
 * can still preserve chapter links when the proposal is approved later. */
export function proposalChapterOrigins(text: string, current: string): Record<string, string> {
  const encoded = ORIGINS.exec(text)?.[1];
  if (encoded) {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.entries(value).some(
        ([number, title]) => !/^\d+$/.test(number) || typeof title !== "string" || title.length > 200,
      )
    )
      throw new Error("Invalid proposal chapter origins");
    return value as Record<string, string>;
  }
  const live = parseCurriculum(current);
  const proposed = parseCurriculum(parsePlanProposal(text).curriculum);
  const origins: Record<string, string> = {};
  const used = new Set<string>();
  for (const chapter of proposed) {
    const exact = live.find((c) => c.title === chapter.title);
    if (exact) {
      origins[String(chapter.number)] = exact.title;
      used.add(exact.title);
    }
  }
  for (const chapter of proposed) {
    if (origins[String(chapter.number)]) continue;
    const matches = live.filter((c) => !used.has(c.title) && c.scope === chapter.scope && c.scope.trim());
    if (matches.length === 1 && matches[0]) {
      origins[String(chapter.number)] = matches[0].title;
      used.add(matches[0].title);
    }
  }
  return origins;
}

export function setProposalChapterOrigins(text: string, origins: Record<string, string>): string {
  const marker = `<!-- studium-chapter-origins: ${Buffer.from(JSON.stringify(origins)).toString("base64")} -->`;
  return ORIGINS.test(text) ? text.replace(ORIGINS, marker) : `${text.trimEnd()}\n\n${marker}\n`;
}
