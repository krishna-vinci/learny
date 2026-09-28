import type { Dirent, Stats } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CheckIssue, InboxItem } from "@studium/shared";
import { NoteFrontmatter, parseFrontmatter } from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { EventHub } from "../events.js";
import { editFile } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

export interface InboxRoutesDeps {
  root: string;
  locks: FileLocks;
  hub: EventHub;
}

const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;

function notFound(c: Context): Response {
  return c.json({ error: "not found" }, 404);
}

async function setExists(root: string, set: string): Promise<boolean> {
  if (!isSetSlug(set)) return false;
  try {
    return (await fs.stat(resolveInRoot(root, set))).isDirectory();
  } catch {
    return false;
  }
}

function checkSummary(report: string): string {
  const match = /^## Summary\s*\r?\n([\s\S]*?)(?=^##\s|\s*$)/im.exec(report);
  return (match?.[1] ?? "").trim();
}

export function parseCheckReport(report: string): InboxItem["check"] {
  const issues: CheckIssue[] = [];
  const heading = /^###\s+(?:\d+[.)]\s*)?(Blocker|Major|Minor)(?:\s+[—–-]\s*(.*))?\s*$/gim;
  const matches = [...report.matchAll(heading)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    if (match === undefined) continue;
    const severity = match[1]?.toLowerCase() as CheckIssue["severity"] | undefined;
    if (severity === undefined) continue;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? report.length;
    const body = report.slice(bodyStart, bodyEnd).trim();
    const title = match[2]?.trim();
    const problem = /^-\s*\*\*Problem:\*\*\s*(.+)$/im.exec(body)?.[1]?.trim();
    const claim = /^-\s*\*\*Claim:\*\*\s*(.+)$/im.exec(body)?.[1]?.trim();
    const text =
      title ||
      problem ||
      claim ||
      body
        .split(/\r?\n/, 1)[0]
        ?.replace(/^[-*]\s*/, "")
        .trim() ||
      severity;
    issues.push({ severity, text });
  }
  const summary = checkSummary(report);
  if (issues.length === 0 && summary === "" && !/^##\s+No issues found\b/im.test(report)) return null;
  return { issues, summary };
}

async function readInbox(root: string, set: string): Promise<InboxItem[]> {
  const notesDir = resolveInRoot(root, `${set}/notes`);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(notesDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const items: InboxItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const noteRel = `notes/${entry.name}`;
    const noteRootRel = `${set}/${noteRel}`;
    let text: string;
    let stat: Stats;
    try {
      [text, stat] = await Promise.all([
        fs.readFile(resolveInRoot(root, noteRootRel), "utf8"),
        fs.stat(resolveInRoot(root, noteRootRel)),
      ]);
    } catch {
      continue;
    }
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseFrontmatter(text).frontmatter;
    } catch {
      continue;
    }
    const parsed = NoteFrontmatter.safeParse(frontmatter);
    if (!parsed.success || (parsed.data.status !== "draft" && parsed.data.status !== "checked")) continue;
    const reportRootRel = `${set}/log/checks/${entry.name}`;
    let check: InboxItem["check"] = null;
    try {
      check = parseCheckReport(await fs.readFile(resolveInRoot(root, reportRootRel), "utf8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    items.push({
      path: noteRel,
      title: parsed.data.title ?? entry.name.replace(/\.md$/, ""),
      status: parsed.data.status,
      check,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function frontmatterStatusLine(text: string): { line: string; status: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (block?.[1] === undefined) throw new Error("note has no valid frontmatter block");
  const matches = block[1].match(/^status:\s*([^\r\n]+)$/gm) ?? [];
  if (matches.length !== 1 || matches[0] === undefined) throw new Error("note must have exactly one status line");
  const status = matches[0].slice(matches[0].indexOf(":") + 1).trim();
  return { line: matches[0], status };
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await c.req.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function inboxRoutes(deps: InboxRoutesDeps): Hono {
  const app = new Hono();

  app.get("/inbox", async (c) => {
    const set = c.req.param("set");
    if (set === undefined) return notFound(c);
    if (!(await setExists(deps.root, set))) return notFound(c);
    return c.json(await readInbox(deps.root, set));
  });

  app.post("/notes/accept", async (c) => {
    const set = c.req.param("set");
    if (set === undefined) return notFound(c);
    if (!(await setExists(deps.root, set))) return notFound(c);
    const body = await jsonBody(c);
    const notePath = typeof body.path === "string" ? body.path : "";
    if (!NOTE_PATH.test(notePath) || path.posix.normalize(notePath) !== notePath) {
      return c.json({ error: "invalid note path" }, 400);
    }
    const noteRootPath = `${set}/${notePath}`;
    let note: string;
    try {
      note = await fs.readFile(resolveInRoot(deps.root, noteRootPath), "utf8");
    } catch {
      return notFound(c);
    }
    let current: { line: string; status: string };
    try {
      current = frontmatterStatusLine(note);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (current.status !== "draft" && current.status !== "checked") {
      return c.json({ error: "note is not awaiting acceptance" }, 409);
    }
    await editFile(
      deps.root,
      deps.locks,
      `user:accept:${crypto.randomUUID()}`,
      noteRootPath,
      current.line,
      "status: accepted",
      {
        canWrite: (candidate) => candidate === noteRootPath,
      },
    );
    const subject = `user: accept ${notePath}`;
    const sha = await commitPaths(deps.root, [noteRootPath], subject, "user");
    if (sha === null) return c.json({ error: "nothing to accept" }, 409);
    deps.hub.publish({ type: "commit", sha, subject, author: "user" });
    return c.json({ sha });
  });

  return app;
}
