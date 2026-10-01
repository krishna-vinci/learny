import { promises as fs } from "node:fs";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createFile, editFile, readText } from "../tree/edit.js";
import type { FileLocks } from "../tree/lock.js";
import { canonicalRel, isWritableByAgent, resolveInRoot } from "../tree/paths.js";
import { mediaWarnings } from "./media-warnings.js";
import { noteLint } from "./note-lint.js";

interface ToolDetails {
  isError: boolean;
  summary: string;
  path?: string;
  warnings?: string[];
}

export interface StudyToolContext {
  root: string;
  scope: { set: string | null; library: boolean };
  write: (rootRelativePath: string) => boolean;
  locks: FileLocks;
  holder: string;
  onWrite?: (rootRelativePath: string) => void;
}

interface TutorToolContext {
  root: string;
  set: string;
  locks: FileLocks;
  holder: string;
  onWrite?: (rootRelativePath: string) => void;
}

function result(summary: string, text = summary, details: Omit<ToolDetails, "isError" | "summary"> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details: { ...details, isError: false, summary },
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true, summary: message },
  };
}

interface ScopedPath {
  lexical: string;
  canonical: string;
}

function isInScope(ctx: StudyToolContext, rootRel: string): boolean {
  if (rootRel === "library" || rootRel.startsWith("library/")) return ctx.scope.library;
  return ctx.scope.set !== null && (rootRel === ctx.scope.set || rootRel.startsWith(`${ctx.scope.set}/`));
}

function rootRelative(ctx: StudyToolContext, rel: string): ScopedPath {
  let combined: string;
  if (rel === "library" || rel.startsWith("library/")) {
    if (!ctx.scope.library) throw new Error(`Path is outside this role's study scope: ${rel}`);
    combined = rel;
  } else if (ctx.scope.set !== null) {
    combined = `${ctx.scope.set}/${rel}`;
  } else if (ctx.scope.library) {
    combined = `library/${rel}`;
  } else {
    throw new Error(`Path is outside this role's study scope: ${rel}`);
  }
  resolveInRoot(ctx.root, combined);
  const canonical = canonicalRel(ctx.root, combined);
  if (!isInScope(ctx, combined) || !isInScope(ctx, canonical)) {
    throw new Error(`Path is outside this role's study scope: ${rel}`);
  }
  return { lexical: combined, canonical };
}

function writableRootRelative(ctx: StudyToolContext, rel: string): string {
  const scoped = rootRelative(ctx, rel);
  if (!ctx.write(scoped.lexical) || !ctx.write(scoped.canonical)) {
    throw new Error(`Path is not writable by this role: ${rel}`);
  }
  return scoped.lexical;
}

function hiddenChatPath(rootRel: string): boolean {
  return rootRel.split("/").includes("chats");
}

function countLines(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length;
}

export function studyTools(ctx: StudyToolContext): ToolDefinition[] {
  const studyList = defineTool({
    name: "study_list",
    label: "List study files",
    description: "List files and directories inside the role's allowed study-tree scope.",
    parameters: Type.Object({ dir: Type.Optional(Type.String()) }),
    async execute(_toolCallId, params) {
      try {
        const rel = params.dir ?? ".";
        const scoped = rootRelative(ctx, rel);
        if (hiddenChatPath(scoped.lexical) || hiddenChatPath(scoped.canonical)) {
          throw new Error("Chat transcripts are not available to agents");
        }
        const abs = resolveInRoot(ctx.root, scoped.lexical);
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const names = entries
          .filter((entry) => entry.name !== "chats")
          .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
          .sort((a, b) => a.localeCompare(b));
        return result(`listed ${rel}`, names.join("\n") || "(empty)", { path: rel });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  const studyRead = defineTool({
    name: "study_read",
    label: "Read study file",
    description: "Read numbered lines from a file in the role's allowed study-tree scope.",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_toolCallId, params) {
      try {
        const scoped = rootRelative(ctx, params.path);
        if (hiddenChatPath(scoped.lexical) || hiddenChatPath(scoped.canonical)) {
          throw new Error("Chat transcripts are not available to agents");
        }
        const text = await readText(ctx.root, scoped.lexical);
        const offset = params.offset ?? 1;
        const limit = params.limit ?? 400;
        const lines = text.split("\n").slice(offset - 1, offset - 1 + limit);
        const numbered = lines.map((line, index) => `${offset + index}\t${line}`).join("\n");
        return result(`read ${params.path}`, numbered, { path: params.path });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  const studyEdit = defineTool({
    name: "study_edit",
    label: "Edit study file",
    description: "Surgically replace exact text in a file allowed for this role.",
    parameters: Type.Object({
      path: Type.String(),
      old_string: Type.String(),
      new_string: Type.String(),
      replace_all: Type.Optional(Type.Boolean()),
    }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        const combined = writableRootRelative(ctx, params.path);
        await editFile(ctx.root, ctx.locks, ctx.holder, combined, params.old_string, params.new_string, {
          replaceAll: params.replace_all ?? false,
          canWrite: ctx.write,
        });
        ctx.onWrite?.(combined);
        const added = countLines(params.new_string);
        const removed = countLines(params.old_string);
        const summary = `edited ${params.path} (+${added} −${removed} lines)`;
        const text = await readText(ctx.root, combined);
        const warnings = [...(await mediaWarnings(ctx.root, combined, text)), ...noteLint(combined, text)];
        return result(summary, [summary, ...warnings.map((warning) => `Warning: ${warning}`)].join("\n"), {
          path: params.path,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  const studyCreate = defineTool({
    name: "study_create",
    label: "Create study file",
    description: "Create a new file at a path allowed for this role.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        const combined = writableRootRelative(ctx, params.path);
        await createFile(ctx.root, ctx.locks, ctx.holder, combined, params.content, { canWrite: ctx.write });
        ctx.onWrite?.(combined);
        const summary = `created ${params.path}`;
        const text = await readText(ctx.root, combined);
        const warnings = [...(await mediaWarnings(ctx.root, combined, text)), ...noteLint(combined, text)];
        return result(summary, [summary, ...warnings.map((warning) => `Warning: ${warning}`)].join("\n"), {
          path: params.path,
          ...(warnings.length ? { warnings } : {}),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  return [studyList, studyRead, studyEdit, studyCreate];
}

export const STUDY_TOOL_NAMES = ["study_list", "study_read", "study_edit", "study_create"] as const;

export function tutorTools(ctx: TutorToolContext): ToolDefinition[] {
  return studyTools({
    root: ctx.root,
    scope: { set: ctx.set, library: true },
    write: isWritableByAgent,
    locks: ctx.locks,
    holder: ctx.holder,
    ...(ctx.onWrite === undefined ? {} : { onWrite: ctx.onWrite }),
  });
}

export const TUTOR_TOOL_NAMES = STUDY_TOOL_NAMES;
