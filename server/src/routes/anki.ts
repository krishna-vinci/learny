import { promises as fs } from "node:fs";
import {
  type AnkiClient,
  AnkiConnectClient,
  AnkiConnectError,
  parseFrontmatter,
  type SyncCard,
  syncCards,
} from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { escapeHtml, markdownToAnkiHtml } from "../anki/html.js";
import { CARD_FILE_PATH, listCardFiles, markCardsExported, readCardFile } from "../cards/store.js";
import type { EventHub } from "../events.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

/**
 * `POST /api/sets/:set/anki/sync` — push approved/exported cards to desktop Anki over
 * AnkiConnect. The note types, field names and field content mirror the `.apkg` writer
 * (see `shared/src/ankiconnect.ts` and `server/src/anki/apkg.ts`), so a synced note and
 * an exported note are the same note. Disabled (503) unless `ANKICONNECT_URL` is set.
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

/** A syncable card enriched with the deck and note path the route derives for it. */
interface SyncSourceCard extends SyncCard {
  deck: string;
  notePath: string;
  q?: string;
  a?: string;
  text?: string;
  extra?: string;
  src?: string;
}

const SOURCE_ID = /^lib-[a-z0-9][a-z0-9-]*$/;

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
async function readSyncCards(root: string, set: string, only?: string): Promise<SyncSourceCard[]> {
  const paths = (await listCardFiles(root, set))
    .map((file) => file.path)
    .filter((path) => only === undefined || path === only);
  const cards: SyncSourceCard[] = [];

  for (const path of paths) {
    const detail = await readCardFile(root, set, path);
    if (detail === null) continue;
    const deck = `Studium::${set}::${path.slice("cards/".length).replace(/\.md$/, "")}`;
    for (const card of detail.cards) {
      if (card.status !== "approved" && card.status !== "exported") continue;
      cards.push({
        id: card.id,
        type: card.type,
        deck,
        notePath: detail.note ?? "",
        ...(card.q === undefined ? {} : { q: card.q }),
        ...(card.a === undefined ? {} : { a: card.a }),
        ...(card.text === undefined ? {} : { text: card.text }),
        ...(card.extra === undefined ? {} : { extra: card.extra }),
        ...(card.src === undefined ? {} : { src: card.src }),
      });
    }
  }
  return cards;
}

/** `Source: <title> — <locator>` labels, matching the `.apkg` export. */
async function sourceLabels(root: string, cards: readonly SyncSourceCard[]): Promise<Record<string, string>> {
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

function noteLink(baseUrl: string | undefined, set: string, notePath: string): string {
  const base = baseUrl?.replace(/\/+$/, "");
  if (base === undefined || base === "") return escapeHtml(notePath);
  const rest = notePath.replace(/^notes\//, "");
  const href = `${base}/s/${encodeURIComponent(set)}/n/${rest.split("/").map(encodeURIComponent).join("/")}`;
  return `<a href="${escapeHtml(href)}">${escapeHtml(notePath)}</a>`;
}

/** Field values keyed by the Studium note type's field names (same as `.apkg`). */
function fieldsFor(
  card: SyncSourceCard,
  set: string,
  labels: Record<string, string>,
  baseUrl: string | undefined,
): Record<string, string> {
  const source = card.src === undefined ? "" : escapeHtml(labels[card.src] ?? card.src);
  const link = noteLink(baseUrl, set, card.notePath);
  const common = { CardId: escapeHtml(card.id), Source: source, NoteLink: link };
  return card.type === "basic"
    ? { Front: markdownToAnkiHtml(card.q ?? ""), Back: markdownToAnkiHtml(card.a ?? ""), ...common }
    : { Text: markdownToAnkiHtml(card.text ?? ""), Extra: markdownToAnkiHtml(card.extra ?? ""), ...common };
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

    const cards = await readSyncCards(deps.root, set, typeof only === "string" ? only : undefined);
    if (cards.length === 0) return c.json({ error: "no cards to sync" }, 400);

    const client =
      deps.client ?? new AnkiConnectClient({ url, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });
    const labels = await sourceLabels(deps.root, cards);
    const baseUrl = deps.baseUrl === undefined ? process.env.STUDIUM_BASE_URL : (deps.baseUrl ?? undefined);

    try {
      const result = await syncCards(client, cards, {
        deckFor: (card) => card.deck,
        toFields: (card) => fieldsFor(card, set, labels, baseUrl),
      });

      const syncedIds = cards.filter((card) => result.ankiIds[card.id] !== undefined).map((card) => card.id);
      if (syncedIds.length > 0) {
        const marked = await markCardsExported(deps.root, deps.locks, set, syncedIds, result.ankiIds);
        if (marked.commit.sha !== null) {
          deps.hub?.publish({ type: "commit", sha: marked.commit.sha, subject: marked.commit.subject, author: "user" });
        }
      }

      return c.json({ added: result.added, updated: result.updated, failed: result.failed });
    } catch (error) {
      if (error instanceof AnkiConnectError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });

  return app;
}
