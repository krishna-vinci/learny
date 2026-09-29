import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseCardFile, renderCritic, setCardCommentField } from "@studium/shared";
import { Type } from "typebox";
import { editFile } from "../../tree/edit.js";
import type { FileLocks } from "../../tree/lock.js";
import { resolveInRoot } from "../../tree/paths.js";

interface CardToolBase {
  root: string;
  locks: FileLocks;
  holder: string;
  cardRootPath: string;
  onWrite?: (path: string) => void;
}

interface AddCardToolOptions extends CardToolBase {
  maxAdds: number;
  onAdd?: (id: string) => void;
}

interface ReviewCardToolOptions extends CardToolBase {
  allowedIds: readonly string[];
  onReview?: (id: string) => void;
}

interface QuizToolOptions {
  root: string;
  set: string;
  locks: FileLocks;
  holder: string;
  onWrite?: (path: string) => void;
  now?: () => Date;
}

function ok(summary: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text: summary }],
    details: { isError: false, summary, ...details },
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true, summary: message },
  };
}

function requireCardText(name: string, value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (text === "") throw new Error(`${name} is required`);
  if (/^##[ \t]+/m.test(text)) throw new Error(`${name} must not contain a level-two heading`);
  return text;
}

function isBlank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === "";
}

function optionalCardText(name: string, value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return requireCardText(name, value);
}

function commentValue(name: string, value: string): string {
  const text = value.trim();
  if (text === "") throw new Error(`${name} is required`);
  if (/\r|\n|\u00b7|-->|[()]/.test(text)) throw new Error(`${name} contains unsupported comment characters`);
  return text;
}

async function appendSynced(abs: string, text: string): Promise<void> {
  const handle = await fs.open(abs, "a");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function addCardTool(opts: AddCardToolOptions): ToolDefinition {
  let added = 0;
  return defineTool({
    name: "add_card",
    label: "Add a draft card",
    description: "Append one draft card to this job's pinned card file and generate its permanent id.",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("basic"), Type.Literal("cloze")]),
      // Strict tool-calling models (OpenAI-style) send every property, filling unused ones with "" or null.
      q: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      a: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      extra: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      src: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        if (added >= opts.maxAdds) throw new Error(`this run may add at most ${opts.maxAdds} cards`);
        const src = isBlank(params.src) ? undefined : commentValue("src", params.src as string);
        let body: string;
        if (params.type === "basic") {
          const q = requireCardText("q", params.q ?? undefined);
          const a = requireCardText("a", params.a ?? undefined);
          if (!isBlank(params.text)) throw new Error("basic cards do not accept text");
          const extra = optionalCardText("extra", params.extra ?? undefined);
          body = `**Q:** ${q}\n**A:** ${a}\n${extra === undefined ? "" : `**Extra:** ${extra}\n`}`;
        } else {
          const text = requireCardText("text", params.text ?? undefined);
          if (!/\{\{c[1-9]\d*::[\s\S]+?\}\}/.test(text)) {
            throw new Error("cloze text requires at least one {{cN::...}} deletion");
          }
          if (!isBlank(params.q) || !isBlank(params.a)) throw new Error("cloze cards do not accept q or a");
          const extra = optionalCardText("extra", params.extra ?? undefined);
          body = `**Text:** ${text}\n${extra === undefined ? "" : `**Extra:** ${extra}\n`}`;
        }

        const abs = resolveInRoot(opts.root, opts.cardRootPath);
        let id = "";
        await opts.locks.withLock(opts.cardRootPath, opts.holder, async () => {
          const current = await fs.readFile(abs, "utf8");
          const ids = new Set(parseCardFile(current).cards.map((card) => card.id));
          do id = `c-${randomBytes(4).toString("hex")}`;
          while (ids.has(id));
          const comment = `<!-- status: draft · type: ${params.type}${src === undefined ? "" : ` · src: ${src}`} -->`;
          const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
          await appendSynced(abs, `${separator}## ${id}\n${comment}\n${body}`);
        });
        added += 1;
        opts.onWrite?.(opts.cardRootPath);
        opts.onAdd?.(id);
        return ok(`added draft card ${id}`, { id, path: opts.cardRootPath });
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}

export function reviewCardTool(opts: ReviewCardToolOptions): ToolDefinition {
  const allowed = new Set(opts.allowedIds);
  return defineTool({
    name: "review_card",
    label: "Review a card",
    description: "Record the Critic verdict for one card assigned to this review run.",
    parameters: Type.Object({
      id: Type.String({ pattern: "^c-[0-9a-f]{8}$" }),
      verdict: Type.Union([Type.Literal("ok"), Type.Literal("reject")]),
      rule: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 20 }), Type.Null()])),
      reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        if (!allowed.has(params.id)) throw new Error(`card is not assigned to this review: ${params.id}`);
        if (params.verdict === "ok" && (params.rule != null || !isBlank(params.reason))) {
          throw new Error("an ok verdict must not include a rule or reason");
        }
        const reason = isBlank(params.reason) ? undefined : commentValue("reason", params.reason as string);
        const text = await fs.readFile(resolveInRoot(opts.root, opts.cardRootPath), "utf8");
        const parsed = parseCardFile(text);
        const card = parsed.cards.find((candidate) => candidate.id === params.id);
        if (card === undefined) throw new Error(`card not found: ${params.id}`);
        const critic =
          params.verdict === "ok"
            ? ({ verdict: "ok" } as const)
            : ({
                verdict: "reject",
                ...(params.rule == null ? {} : { rule: params.rule }),
                ...(reason === undefined ? {} : { reason }),
              } as const);
        let next = setCardCommentField(card, "critic", renderCritic(critic));
        const status = params.verdict === "reject" ? "rejected" : card.status === "rejected" ? "draft" : card.status;
        if (status === null) throw new Error(`card has no valid status: ${params.id}`);
        next = setCardCommentField(next, "status", status);
        if (next.raw !== card.raw) {
          await editFile(opts.root, opts.locks, opts.holder, opts.cardRootPath, card.raw, next.raw, {
            canWrite: (candidate) => candidate === opts.cardRootPath,
          });
          opts.onWrite?.(opts.cardRootPath);
        }
        opts.onReview?.(params.id);
        return ok(`reviewed ${params.id}: ${params.verdict}`, { id: params.id, path: opts.cardRootPath });
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}

function quizValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").replaceAll("|", "\\|");
}

export function recordQuizResultTool(opts: QuizToolOptions): ToolDefinition {
  const rootRel = `${opts.set}/log/quiz.md`;
  return defineTool({
    name: "record_quiz_result",
    label: "Record quiz result",
    description: "Append one graded quiz result to this study set's private quiz log.",
    parameters: Type.Object({
      topic: Type.String({ minLength: 1 }),
      question: Type.String({ minLength: 1 }),
      verdict: Type.Union([Type.Literal("right"), Type.Literal("partial"), Type.Literal("wrong")]),
      gap: Type.Optional(Type.String()),
    }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        const topic = quizValue(params.topic);
        const question = quizValue(params.question);
        if (topic === "" || question === "") throw new Error("topic and question are required");
        const gap = params.gap === undefined ? undefined : quizValue(params.gap);
        const line = `- ${(opts.now ?? (() => new Date()))().toISOString()} | topic: ${topic} | question: ${question} | verdict: ${params.verdict}${gap === undefined || gap === "" ? "" : ` | gap: ${gap}`}\n`;
        const abs = resolveInRoot(opts.root, rootRel);
        await opts.locks.withLock(rootRel, opts.holder, async () => {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          let prefix = "";
          try {
            const current = await fs.readFile(abs, "utf8");
            prefix = current === "" ? "# Quiz log\n\n" : current.endsWith("\n") ? "" : "\n";
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
            prefix = "# Quiz log\n\n";
          }
          await appendSynced(abs, prefix + line);
        });
        opts.onWrite?.(rootRel);
        return ok(`recorded ${params.verdict} quiz result`, { path: rootRel });
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}
