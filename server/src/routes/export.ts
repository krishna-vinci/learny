import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import { parseFrontmatter } from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { createApkg, type ExportCard } from "../anki/apkg.js";
import type { EventHub } from "../events.js";
import { editFile } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

export interface ExportRoutesDeps {
  root: string;
  locks: FileLocks;
  hub?: EventHub;
  baseUrl?: string | null;
}

type ExportStatus = "approved" | "exported";
type AdaptedCard = ExportCard & {
  status: ExportStatus;
  filePath: string;
  section: string;
};

const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;
const CARD_FILE = /^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;
const CARD_HEADING = /^## (c-[0-9a-f]{8})[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/gm;
const CARD_FIELD = /^\*\*(Q|A|Text|Extra):\*\*[ \t]*([\s\S]*?)(?=^\*\*(?:Q|A|Text|Extra):\*\*|(?![\s\S]))/gm;

class ExportInputError extends Error {}

async function setExists(root: string, set: string): Promise<boolean> {
  if (!isSetSlug(set)) return false;
  try {
    return (await fs.stat(resolveInRoot(root, set))).isDirectory();
  } catch {
    return false;
  }
}

function commentMetadata(sectionBody: string): Record<string, string> {
  const comment = /<!--[ \t]*([\s\S]*?)[ \t]*-->/.exec(sectionBody)?.[1];
  if (comment === undefined) return {};
  const metadata: Record<string, string> = {};
  for (const part of comment.split("·")) {
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key !== "") metadata[key] = value;
  }
  return metadata;
}

function cardFields(sectionBody: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of sectionBody.matchAll(CARD_FIELD)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) fields[name] = value.trim();
  }
  return fields;
}

// TODO(T1 merge): use shared/src/cards.ts instead of this temporary read adapter.
async function readExportCards(root: string, set: string, noteFilter?: string): Promise<AdaptedCard[]> {
  const cardsDirectory = resolveInRoot(root, `${set}/cards`);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(cardsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const cards: AdaptedCard[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !CARD_FILE.test(entry.name)) continue;
    const filePath = `${set}/cards/${entry.name}`;
    const text = await fs.readFile(resolveInRoot(root, filePath), "utf8");
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(text);
    } catch (cause) {
      throw new ExportInputError(`Invalid card file frontmatter: ${entry.name}`, { cause });
    }
    const notePath = parsed.frontmatter.note;
    if (typeof notePath !== "string" || !NOTE_PATH.test(notePath)) {
      throw new ExportInputError(`Invalid note path in cards/${entry.name}`);
    }
    if (noteFilter !== undefined && notePath !== noteFilter) continue;

    const deck = `Studium::${set}::${entry.name.replace(/\.md$/, "")}`;
    for (const match of parsed.body.matchAll(CARD_HEADING)) {
      const id = match[1];
      const body = match[2];
      if (id === undefined || body === undefined) continue;
      const metadata = commentMetadata(body);
      if (metadata.status !== "approved" && metadata.status !== "exported") continue;
      if (metadata.type !== "basic" && metadata.type !== "cloze") {
        throw new ExportInputError(`Card ${id} has an invalid type`);
      }
      const fields = cardFields(body);
      const common = {
        id,
        status: metadata.status,
        type: metadata.type,
        deck,
        notePath,
        filePath,
        section: match[0],
        ...(metadata.src === undefined ? {} : { src: metadata.src }),
      } as const;
      if (metadata.type === "basic") {
        if (fields.Q === undefined || fields.A === undefined) {
          throw new ExportInputError(`Basic card ${id} requires Q and A fields`);
        }
        cards.push({ ...common, type: "basic", q: fields.Q, a: fields.A });
      } else {
        if (fields.Text === undefined) throw new ExportInputError(`Cloze card ${id} requires a Text field`);
        if (!/{{c\d+::/i.test(fields.Text)) {
          throw new ExportInputError(`Cloze card ${id} requires at least one {{cN::}} deletion`);
        }
        cards.push({
          ...common,
          type: "cloze",
          text: fields.Text,
          ...(fields.Extra === undefined ? {} : { extra: fields.Extra }),
        });
      }
    }
  }
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) throw new ExportInputError(`Duplicate card id: ${card.id}`);
    seen.add(card.id);
  }
  return cards;
}

async function sourceLabels(root: string, cards: ExportCard[]): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const source of new Set(cards.flatMap((card) => (card.src === undefined ? [] : [card.src])))) {
    const [id, locator] = source.split("#", 2);
    if (id === undefined || !/^lib-[a-z0-9][a-z0-9-]*$/.test(id)) continue;
    try {
      const text = await fs.readFile(resolveInRoot(root, `library/${id}/source.md`), "utf8");
      const title = parseFrontmatter(text).frontmatter.title;
      if (typeof title === "string" && title.trim() !== "") {
        labels[source] = locator === undefined || locator === "" ? title : `${title} — ${locator}`;
      }
    } catch {
      // A missing or user-broken source registry entry falls back to the source id.
    }
  }
  return labels;
}

async function markApprovedExported(deps: ExportRoutesDeps, cards: AdaptedCard[]): Promise<void> {
  const approved = cards.filter((card) => card.status === "approved");
  if (approved.length === 0) return;

  const changedPaths = new Set<string>();
  for (const card of approved) {
    const updatedSection = card.section.replace(/(<!--[\s\S]*?\bstatus:\s*)approved\b/, "$1exported");
    if (updatedSection === card.section) throw new ExportInputError(`Card ${card.id} has no editable status`);
    await editFile(
      deps.root,
      deps.locks,
      `user:export:${crypto.randomUUID()}`,
      card.filePath,
      card.section,
      updatedSection,
      { canWrite: (candidate) => candidate === card.filePath },
    );
    changedPaths.add(card.filePath);
  }

  const paths = [...changedPaths].sort();
  const subject = `user: export ${approved.length} card${approved.length === 1 ? "" : "s"}`;
  const sha = await commitPaths(deps.root, paths, subject, "user");
  if (sha !== null) deps.hub?.publish({ type: "commit", sha, subject, author: "user" });
}

function queryMode(c: Context): "approved" | "approved+exported" | null {
  const value = c.req.query("cards") ?? "approved";
  return value === "approved" || value === "approved+exported" ? value : null;
}

export function exportRoutes(deps: ExportRoutesDeps): Hono {
  const app = new Hono();

  app.get("/export.apkg", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return c.json({ error: "not found" }, 404);
    const mode = queryMode(c);
    if (mode === null) return c.json({ error: "cards must be approved or approved+exported" }, 400);
    const note = c.req.query("note");
    if (note !== undefined && !NOTE_PATH.test(note)) return c.json({ error: "invalid note path" }, 400);

    try {
      const available = await readExportCards(deps.root, set, note);
      const included = available.filter((card) => card.status === "approved" || mode === "approved+exported");
      if (included.length === 0) return c.json({ error: "no cards to export" }, 400);
      const baseUrl = deps.baseUrl === undefined ? process.env.STUDIUM_BASE_URL : deps.baseUrl;
      const packageBytes = await createApkg(included, {
        set,
        baseUrl,
        sourceLabels: await sourceLabels(deps.root, included),
      });
      await markApprovedExported(deps, included);

      return c.body(Uint8Array.from(packageBytes).buffer, 200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="studium-${set}.apkg"`,
        "content-length": String(packageBytes.byteLength),
      });
    } catch (error) {
      if (error instanceof ExportInputError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  return app;
}
