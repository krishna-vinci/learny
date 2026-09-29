import { promises as fs } from "node:fs";
import {
  CARD_ID_PATTERN,
  type CardFileDetail,
  type CardFileView,
  type CardPatch,
  type CardStatus,
} from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  approveCleanCards,
  CARD_FILE_PATH,
  CardStoreError,
  listCardFiles,
  markCardsExported,
  patchCard,
  readCardFile,
} from "../cards/store.js";
import type { EventHub } from "../events.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

export interface CardsRoutesDeps {
  root: string;
  locks: FileLocks;
  hub: EventHub;
}

const PATCH_STATUSES: readonly CardStatus[] = ["draft", "approved", "rejected"];

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

function storeError(c: Context, error: CardStoreError): Response {
  if (error.code === "not_found") return c.json({ error: error.message }, 404);
  if (error.code === "invalid") return c.json({ error: error.message }, 400);
  return c.json({ error: error.message }, 409);
}

function parsePatch(body: Record<string, unknown>): CardPatch | Response {
  const patch: CardPatch = {};
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !PATCH_STATUSES.includes(body.status as CardStatus)) {
      return Response.json({ error: "invalid status" }, { status: 400 });
    }
    patch.status = body.status as CardPatch["status"];
  }
  for (const field of ["q", "a", "text", "extra"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return Response.json({ error: `invalid ${field}` }, { status: 400 });
    patch[field] = value;
  }
  return patch;
}

export function cardsRoutes(deps: CardsRoutesDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    const files: CardFileView[] = await listCardFiles(deps.root, set);
    return c.json(files);
  });

  app.get("/file", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    const rel = c.req.query("path");
    if (rel === undefined || rel === "") return c.json({ error: "path is required" }, 400);
    if (!CARD_FILE_PATH.test(rel)) return c.json({ error: "invalid card path" }, 400);
    try {
      const detail: CardFileDetail | null = await readCardFile(deps.root, set, rel);
      if (detail === null) return notFound(c);
      return c.json(detail);
    } catch (error) {
      if (error instanceof CardStoreError) return storeError(c, error);
      throw error;
    }
  });

  app.patch("/:id", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    const id = c.req.param("id");
    if (!CARD_ID_PATTERN.test(id))
      return c.json({ error: "card id must match c- followed by 8 lowercase hex characters" }, 400);
    const patch = parsePatch(await jsonBody(c));
    if (patch instanceof Response) return patch;
    try {
      const { card, commit } = await patchCard(deps.root, deps.locks, set, id, patch);
      if (commit.sha !== null)
        deps.hub.publish({ type: "commit", sha: commit.sha, subject: commit.subject, author: "user" });
      return c.json(card);
    } catch (error) {
      if (error instanceof CardStoreError) return storeError(c, error);
      throw error;
    }
  });

  app.post("/approve-clean", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    const body = await jsonBody(c);
    const rel = typeof body.path === "string" ? body.path : "";
    if (!CARD_FILE_PATH.test(rel)) return c.json({ error: "invalid card path" }, 400);
    try {
      const result = await approveCleanCards(deps.root, deps.locks, set, rel);
      if (result.commit.sha !== null) {
        deps.hub.publish({ type: "commit", sha: result.commit.sha, subject: result.commit.subject, author: "user" });
      }
      return c.json({ approved: result.approved });
    } catch (error) {
      if (error instanceof CardStoreError) return storeError(c, error);
      throw error;
    }
  });

  app.post("/exported", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    const body = await jsonBody(c);
    const rawIds = body.ids;
    if (!Array.isArray(rawIds) || !rawIds.every((id) => typeof id === "string" && CARD_ID_PATTERN.test(id))) {
      return c.json({ error: "ids must contain only c- followed by 8 lowercase hex characters" }, 400);
    }
    const ankiIds: Record<string, number> = {};
    if (body.ankiIds !== undefined) {
      if (typeof body.ankiIds !== "object" || body.ankiIds === null || Array.isArray(body.ankiIds)) {
        return c.json({ error: "ankiIds must be an object" }, 400);
      }
      for (const [id, value] of Object.entries(body.ankiIds as Record<string, unknown>)) {
        if (!CARD_ID_PATTERN.test(id)) return c.json({ error: `invalid card id in ankiIds: ${id}` }, 400);
        if (!(rawIds as unknown[]).includes(id))
          return c.json({ error: `ankiIds key is not present in ids: ${id}` }, 400);
        if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
          return c.json({ error: `ankiIds value must be a finite integer: ${id}` }, 400);
        }
        ankiIds[id] = value;
      }
    }
    try {
      const result = await markCardsExported(deps.root, deps.locks, set, rawIds as string[], ankiIds);
      if (result.commit.sha !== null) {
        deps.hub.publish({ type: "commit", sha: result.commit.sha, subject: result.commit.subject, author: "user" });
      }
      return c.json({ updated: result.updated });
    } catch (error) {
      if (error instanceof CardStoreError) return storeError(c, error);
      throw error;
    }
  });

  return app;
}
