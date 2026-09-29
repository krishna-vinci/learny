import { promises as fs } from "node:fs";
import {
  type AnkiClient,
  AnkiConnectClient,
  AnkiConnectError,
  parseFrontmatter,
  type SyncFailure,
  syncCards,
} from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { AnkiPackageInputError, createApkg, type ExportCard } from "../anki/apkg.js";
import { CARD_FILE_PATH, listCardFiles, markCardsExported, readCardFile } from "../cards/store.js";
import { cardExportError } from "../cards/validation.js";
import type { EventHub } from "../events.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

/**
 * `POST /api/sets/:set/anki/sync` — push approved/exported cards to desktop Anki over
 * AnkiConnect. The route builds the same `.apkg` as the download path and imports it,
 * preserving `guid = card id`. Disabled (503) unless `ANKICONNECT_URL` is set.
 */
export interface AnkiRoutesDeps {
  root: string;
  locks: FileLocks;
  hub?: EventHub;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  baseUrl?: string | null;
  /** Test seam: a fake client bypasses the real AnkiConnect transport. */
  client?: AnkiClient;
}

const SOURCE_ID = /^lib-[a-z0-9][a-z0-9-]*$/;
const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;

class SyncInputError extends Error {}
type SyncPackageCard = ExportCard & { existing: boolean };

async function setExists(root: string, set: string): Promise<boolean> {
  if (!isSetSlug(set)) return false;
  try {
    return (await fs.stat(resolveInRoot(root, set))).isDirectory();
  } catch {
    return false;
  }
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

/**
 * Read the set's approved/exported cards (or one `cards/NN-slug.md`). The deck mirrors
 * the `.apkg` writer: `Studium::<set>::<NN-slug>`, so synced and exported notes agree.
 */
async function readSyncCards(
  root: string,
  set: string,
  only?: string,
): Promise<{ cards: SyncPackageCard[]; failed: SyncFailure[] }> {
  const files = (await listCardFiles(root, set)).filter((file) => only === undefined || file.path === only);
  const cards: SyncPackageCard[] = [];
  const failed: SyncFailure[] = [];

  for (const file of files) {
    if (file.error !== undefined) throw new SyncInputError(`${file.path}: ${file.error}`);
    const detail = await readCardFile(root, set, file.path);
    if (detail === null) continue;
    if (detail.error !== undefined) throw new SyncInputError(`${file.path}: ${detail.error}`);
    if (detail.note === null || !NOTE_PATH.test(detail.note)) {
      throw new SyncInputError(`Invalid note path in ${file.path}`);
    }
    const deck = `Studium::${set}::${file.path.slice("cards/".length).replace(/\.md$/, "")}`;
    for (const card of detail.cards) {
      if (card.status !== "approved" && card.status !== "exported") continue;
      const validationError = cardExportError(card);
      if (validationError !== null) {
        failed.push({ id: card.id, error: validationError });
        continue;
      }
      const common = {
        id: card.id,
        deck,
        notePath: detail.note,
        existing: card.status === "exported" || card.ankiId !== undefined,
        ...(card.src === undefined ? {} : { src: card.src }),
      };
      if (card.type === "basic") {
        if (card.q === undefined || card.a === undefined) continue;
        cards.push({ ...common, type: "basic", q: card.q, a: card.a });
      } else {
        if (card.text === undefined) continue;
        cards.push({
          ...common,
          type: "cloze",
          text: card.text,
          ...(card.extra === undefined ? {} : { extra: card.extra }),
        });
      }
    }
  }
  return { cards, failed };
}

/** `Source: <title> — <locator>` labels, matching the `.apkg` export. */
async function sourceLabels(root: string, cards: readonly ExportCard[]): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const sources = new Set(cards.flatMap((card) => (card.src === undefined ? [] : [card.src])));
  for (const source of sources) {
    const [id, locator] = source.split("#", 2);
    if (id === undefined || !SOURCE_ID.test(id)) continue;
    try {
      const text = await fs.readFile(resolveInRoot(root, `library/${id}/source.md`), "utf8");
      const title = parseFrontmatter(text).frontmatter.title;
      if (typeof title === "string" && title.trim() !== "") {
        labels[source] = locator === undefined || locator === "" ? title : `${title} — ${locator}`;
      }
    } catch {
      // A missing source registry entry falls back to the raw source id.
    }
  }
  return labels;
}

export function ankiRoutes(deps: AnkiRoutesDeps): Hono {
  const app = new Hono();

  app.post("/sync", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return c.json({ error: "not found" }, 404);

    const env = deps.env ?? process.env;
    const url = env.ANKICONNECT_URL?.trim();
    if (url === undefined || url === "") return c.json({ error: "AnkiConnect is not configured" }, 503);

    const body = await jsonBody(c);
    const only = body.path;
    if (only !== undefined && (typeof only !== "string" || !CARD_FILE_PATH.test(only))) {
      return c.json({ error: "invalid card path" }, 400);
    }

    try {
      const prepared = await readSyncCards(deps.root, set, typeof only === "string" ? only : undefined);
      if (prepared.cards.length === 0 && prepared.failed.length === 0)
        return c.json({ error: "no cards to sync" }, 400);
      if (prepared.cards.length === 0) return c.json({ added: 0, updated: 0, failed: prepared.failed });

      const client =
        deps.client ?? new AnkiConnectClient({ url, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
      const baseUrl = deps.baseUrl === undefined ? process.env.STUDIUM_BASE_URL : deps.baseUrl;
      const packageBytes = await createApkg(prepared.cards, {
        set,
        baseUrl,
        sourceLabels: await sourceLabels(deps.root, prepared.cards),
      });
      const result = await syncCards(client, prepared.cards, packageBytes);
      result.failed.push(...prepared.failed);

      const syncedIds = prepared.cards.filter((card) => result.ankiIds[card.id] !== undefined).map((card) => card.id);
      if (syncedIds.length > 0) {
        const marked = await markCardsExported(deps.root, deps.locks, set, syncedIds, result.ankiIds);
        if (marked.commit.sha !== null) {
          deps.hub?.publish({ type: "commit", sha: marked.commit.sha, subject: marked.commit.subject, author: "user" });
        }
      }

      return c.json({ added: result.added, updated: result.updated, failed: result.failed });
    } catch (error) {
      if (error instanceof SyncInputError || error instanceof AnkiPackageInputError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof AnkiConnectError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });

  return app;
}
