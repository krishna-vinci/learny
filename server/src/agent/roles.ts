import type { ActiveChapterJob } from "../course/build.js";
import { isWritableByAgent } from "../tree/paths.js";
import type { SkillSummary } from "./builtins/skills.js";
import { buildBatchRolePrompt, buildTutorPrompt } from "./prompt.js";

export type RoleName =
  | "tutor"
  | "librarian"
  | "outliner"
  | "drafter"
  | "checker"
  | "cardsmith"
  | "critic"
  | "examiner"
  | "grader";

export interface RolePromptContext {
  root: string;
  set: string | null;
  skills: readonly SkillSummary[];
  anchor?: string;
  chapterJobs?: readonly ActiveChapterJob[];
}

export interface RoleSpec {
  modelRole: RoleName;
  tools: readonly string[];
  mcpServers: readonly string[];
  skills: readonly string[];
  requiresSet: boolean;
  scope(set: string | null): { set: string | null; library: boolean };
  write(set: string | null, rootRelativePath: string): boolean;
  promptBuilder(context: RolePromptContext): Promise<string>;
}

const STUDY_TOOLS = ["study_list", "study_read", "study_edit", "study_create"] as const;
const SKILL_TOOLS = ["load_skill", "load_skill_reference"] as const;
const RESEARCH_TOOLS = ["wiki_search", "wiki_read", "web_fetch"] as const;
const CHAT_JOB_TOOLS = ["start_job", "add_source", "record_quiz_result"] as const;

function setPath(
  set: string | null,
  directory: "notes" | "log/checks" | "cards" | "assets" | "artifacts" | "visuals",
  rel: string,
): boolean {
  return set !== null && rel.startsWith(`${set}/${directory}/`) && rel.length > `${set}/${directory}/`.length;
}

export const ROLES: Record<RoleName, RoleSpec> = {
  examiner: {
    modelRole: "examiner",
    tools: ["study_list", "study_read", ...SKILL_TOOLS, "add_practice_question", "add_problem"],
    mcpServers: [],
    skills: ["make-quiz", "make-problems"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: (set, rel) =>
      set !== null &&
      (new RegExp(`^${set}/practice/quizzes/quiz-[0-9a-f]{8}\\.json$`).test(rel) ||
        new RegExp(`^${set}/practice/problems/[0-9]{2,}-[a-z0-9][a-z0-9-]*\\.md$`).test(rel)),
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "examiner", root, set, skills }),
  },
  grader: {
    modelRole: "grader",
    tools: ["study_list", "study_read", ...SKILL_TOOLS, "submit_grade"],
    mcpServers: [],
    skills: ["grade-answer"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: () => false,
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "grader", root, set, skills }),
  },
  tutor: {
    modelRole: "tutor",
    tools: [...STUDY_TOOLS, ...RESEARCH_TOOLS, ...SKILL_TOOLS, ...CHAT_JOB_TOOLS, "save_asset"],
    mcpServers: ["searxng", "papers", "context7"],
    skills: ["explain", "evolve-note", "note-authoring", "quiz-me", "find-sources", "media-authoring", "make-visual"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: (_set, rel) => isWritableByAgent(rel),
    promptBuilder: ({ root, set, skills, anchor, chapterJobs }) => {
      if (set === null) throw new Error("The tutor role requires a study set");
      return buildTutorPrompt(root, set, anchor, skills, chapterJobs);
    },
  },
  librarian: {
    modelRole: "librarian",
    tools: [...STUDY_TOOLS, ...SKILL_TOOLS],
    mcpServers: [],
    skills: ["source-summary", "find-sources"],
    requiresSet: false,
    scope: () => ({ set: null, library: true }),
    write: (_set, rel) => /^library\/[^/]+\/source\.md$/.test(rel),
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "librarian", root, set, skills }),
  },
  drafter: {
    modelRole: "drafter",
    tools: [...STUDY_TOOLS, ...RESEARCH_TOOLS, ...SKILL_TOOLS, "save_asset"],
    mcpServers: ["searxng", "papers", "context7"],
    skills: ["draft-chapter", "note-authoring", "media-authoring", "make-visual"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: (set, rel) =>
      ["notes", "assets", "artifacts", "visuals"].some((dir) =>
        setPath(set, dir as "notes" | "assets" | "artifacts" | "visuals", rel),
      ),
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "drafter", root, set, skills }),
  },
  outliner: {
    modelRole: "outliner",
    tools: [...STUDY_TOOLS, ...RESEARCH_TOOLS, ...SKILL_TOOLS],
    mcpServers: ["searxng", "papers", "context7"],
    skills: ["plan-set", "find-sources"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: (set, rel) =>
      set !== null &&
      rel.startsWith(`${set}/plan-proposals/`) &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(rel.slice(`${set}/plan-proposals/`.length)),
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "outliner", root, set, skills }),
  },
  checker: {
    modelRole: "checker",
    tools: [...STUDY_TOOLS, ...RESEARCH_TOOLS, ...SKILL_TOOLS],
    mcpServers: ["searxng", "papers", "context7"],
    skills: ["fact-check"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: (set, rel) => setPath(set, "log/checks", rel),
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "checker", root, set, skills }),
  },
  cardsmith: {
    modelRole: "cardsmith",
    tools: ["study_list", "study_read", "study_edit", ...SKILL_TOOLS, "add_card"],
    mcpServers: [],
    skills: ["make-deck"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: (set, rel) => setPath(set, "cards", rel),
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "cardsmith", root, set, skills }),
  },
  critic: {
    modelRole: "critic",
    tools: ["study_list", "study_read", ...SKILL_TOOLS, "review_card"],
    mcpServers: [],
    skills: ["critique-cards"],
    requiresSet: true,
    scope: (set) => ({ set, library: true }),
    write: () => false,
    promptBuilder: ({ root, set, skills }) => buildBatchRolePrompt({ role: "critic", root, set, skills }),
  },
};
