import { promises as fs } from "node:fs";
import type { SearchKind, SearchResponse, SearchResult } from "@studium/shared";
import { Hono } from "hono";
import type { ChatService } from "../agent/chat-service.js";
import { listSearchSets, type SearchIndex, type SearchQuery } from "../search/index.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

interface SearchRoutesDeps {
  root: string;
  index: SearchIndex;
  chats?: Pick<ChatService, "list">;
}

const KINDS: readonly SearchKind[] = ["note", "source", "card", "chat"];
// Negated bm25 ranks stronger matches higher; chat substring hits rank modestly.
const CHAT_SCORE = 0.0000001;

async function chatResults(deps: SearchRoutesDeps, query: SearchQuery): Promise<SearchResult[]> {
  if (deps.chats === undefined || query.q.trim() === "" || (query.kinds !== undefined && !query.kinds.includes("chat")))
    return [];
  const sets = await listSearchSets(deps.root);
  const results: SearchResult[] = [];
  const needle = query.q.trim().toLowerCase();
  for (const set of sets) {
    if (query.set !== undefined && query.set !== set) continue;
    // ChatService's metadata reader predates search. Check its inputs before
    // asking it to list: neither a chat directory nor a JSONL may escape root.
    try {
      const dir = resolveInRoot(deps.root, `${set}/chats`);
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".jsonl")) resolveInRoot(deps.root, `${set}/chats/${file}`);
      }
    } catch {
      continue;
    }
    for (const chat of await deps.chats.list(set)) {
      if (!chat.title.toLowerCase().includes(needle)) continue;
      // Session ids are the existing chat route identifiers, not JSONL filenames.
      if (!/^[a-zA-Z0-9-]+$/.test(chat.id)) continue;
      results.push({
        kind: "chat",
        set,
        path: `${set}/chats/${chat.id}`,
        title: chat.title,
        snippet: chat.title,
        score: CHAT_SCORE,
      });
    }
  }
  return results;
}

export function searchRoutes(deps: SearchRoutesDeps): Hono {
  const app = new Hono();
  app.get("/", async (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.length > 200)
      return c.json({ error: "q is required and must be at most 200 characters" }, 400);
    const set = c.req.query("set") || undefined;
    if (set !== undefined && !isSetSlug(set)) return c.json({ error: "invalid set" }, 400);
    const rawLimit = c.req.query("limit");
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      return c.json({ error: "limit must be an integer from 1 to 50" }, 400);
    const rawKinds = c.req.queries("kind");
    const kinds = rawKinds?.flatMap((kind) => kind.split(","));
    if (kinds?.some((kind) => !KINDS.includes(kind as SearchKind))) return c.json({ error: "invalid kind" }, 400);
    const query: SearchQuery = { q, set, kinds: kinds as SearchKind[] | undefined, limit };
    const results = [...deps.index.query(query), ...(await chatResults(deps, query))]
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, limit);
    const response: SearchResponse = { results };
    return c.json(response);
  });
  return app;
}
