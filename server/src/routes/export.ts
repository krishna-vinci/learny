import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { AnkiPackageInputError, createApkg, type ExportCard } from "../anki/apkg.js";
import { listCardFiles, markCardsExported, readCardFile } from "../cards/store.js";
import { cardExportError } from "../cards/validation.js";
import type { EventHub } from "../events.js";
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
};

const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;

class ExportInputError extends Error {}

async function setExists(root: string, set: string): Promise<boolean> {
  if (!isSetSlug(set)) return false;
  try {
    return (await fs.stat(resolveInRoot(root, set))).isDirectory();
  } catch {
    return false;
  }
}

async function readExportCards(root: string, set: string, noteFilter?: string): Promise<AdaptedCard[]> {
  const cards: AdaptedCard[] = [];
  for (const file of await listCardFiles(root, set)) {
    if (file.error !== undefined) throw new ExportInputError(`${file.path}: ${file.error}`);
    const detail = await readCardFile(root, set, file.path);
    if (detail === null) continue;
    if (detail.error !== undefined) throw new ExportInputError(`${file.path}: ${detail.error}`);
    const notePath = detail.note;
    if (notePath === null || !NOTE_PATH.test(notePath)) throw new ExportInputError(`Invalid note path in ${file.path}`);
    if (noteFilter !== undefined && notePath !== noteFilter) continue;

    const deck = `Studium::${set}::${path.basename(file.path, ".md")}`;
    for (const card of detail.cards) {
      if (card.status !== "approved" && card.status !== "exported") continue;
      const validationError = cardExportError(card);
      if (validationError !== null) throw new ExportInputError(validationError);
      const common = {
        id: card.id,
        status: card.status,
        deck,
        notePath,
        ...(card.src === undefined ? {} : { src: card.src }),
      } as const;
      if (card.type === "basic") {
        if (card.q === undefined || card.a === undefined)
          throw new ExportInputError(`Basic card ${card.id} is invalid`);
        cards.push({ ...common, type: "basic", q: card.q, a: card.a });
      } else {
        if (card.text === undefined) throw new ExportInputError(`Cloze card ${card.id} is invalid`);
        cards.push({
          ...common,
          type: "cloze",
          text: card.text,
          ...(card.extra === undefined ? {} : { extra: card.extra }),
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

async function markApprovedExported(deps: ExportRoutesDeps, set: string, cards: AdaptedCard[]): Promise<void> {
  const approved = cards.filter((card) => card.status === "approved");
  if (approved.length === 0) return;
  const result = await markCardsExported(
    deps.root,
    deps.locks,
    set,
    approved.map((card) => card.id),
  );
  if (result.commit.sha !== null) {
    deps.hub?.publish({ type: "commit", sha: result.commit.sha, subject: result.commit.subject, author: "user" });
  }
}

function queryMode(c: Context): "approved" | "approved+exported" | null {
  const value = c.req.query("cards") ?? "approved";
  return value === "approved" || value === "approved+exported" ? value : null;
}

/**
 * `mark=0` asks for the package without the side effect of moving approved cards to
 * `exported` — used by the browser sync path, which marks cards afterwards with the
 * real AnkiConnect note ids. The default (and any other value) still marks.
 */
function shouldMark(c: Context): boolean {
  return c.req.query("mark") !== "0";
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
      if (shouldMark(c)) await markApprovedExported(deps, set, included);

      return c.body(Uint8Array.from(packageBytes).buffer, 200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="studium-${set}.apkg"`,
        "content-length": String(packageBytes.byteLength),
      });
    } catch (error) {
      if (error instanceof ExportInputError || error instanceof AnkiPackageInputError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return app;
}
