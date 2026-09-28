import { promises as fs } from "node:fs";
import path from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createFile, editFile, readText } from "../tree/edit.js";
import type { FileLocks } from "../tree/lock.js";
import { isWritableByAgent, resolveInRoot } from "../tree/paths.js";

interface ToolDetails {
  isError: boolean;
  summary: string;
  path?: string;
}

interface TutorToolContext {
  root: string;
  set: string;
  locks: FileLocks;
  holder: string;
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

function rootRelative(ctx: TutorToolContext, rel: string): string {
  const combined = `${ctx.set}/${rel}`;
  resolveInRoot(ctx.root, combined);
  return combined;
}

function writableRootRelative(ctx: TutorToolContext, rel: string): string {
  const combined = rootRelative(ctx, rel);
  if (!isWritableByAgent(combined)) {
    throw new Error(`Path is not writable by the Tutor: ${rel}`);
  }
  return combined;
}

function countLines(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length;
}

export function tutorTools(ctx: TutorToolContext): ToolDefinition[] {
  const studyList = defineTool({
    name: "study_list",
    label: "List study files",
    description: "List files and directories inside the current study set.",
    parameters: Type.Object({ dir: Type.Optional(Type.String()) }),
    async execute(_toolCallId, params) {
      try {
        const rel = params.dir ?? ".";
        const combined = rootRelative(ctx, rel);
        const normalized = path.posix.normalize(rel);
        if (normalized === "chats" || normalized.startsWith("chats/")) {
          throw new Error("The chats directory is not available to the Tutor");
        }
        const abs = resolveInRoot(ctx.root, combined);
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const names = entries
          .filter((entry) => !(normalized === "." && entry.name === "chats"))
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
    description: "Read numbered lines from a file in the current study set.",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_toolCallId, params) {
      try {
        const normalized = path.posix.normalize(params.path);
        if (normalized === "chats" || normalized.startsWith("chats/")) {
          throw new Error("The chats directory is not available to the Tutor");
        }
        const combined = rootRelative(ctx, params.path);
        const text = await readText(ctx.root, combined);
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
    description: "Surgically replace exact text in a note or log file.",
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
        });
        const added = countLines(params.new_string);
        const removed = countLines(params.old_string);
        const summary = `edited ${params.path} (+${added} −${removed} lines)`;
        return result(summary, summary, { path: params.path });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  const studyCreate = defineTool({
    name: "study_create",
    label: "Create study file",
    description: "Create a new note or log file in the current study set.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        const combined = writableRootRelative(ctx, params.path);
        await createFile(ctx.root, ctx.locks, ctx.holder, combined, params.content);
        const summary = `created ${params.path}`;
        return result(summary, summary, { path: params.path });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  return [studyList, studyRead, studyEdit, studyCreate];
}

export const TUTOR_TOOL_NAMES = ["study_list", "study_read", "study_edit", "study_create"] as const;
