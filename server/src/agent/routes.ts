import type { Context } from "hono";
import { Hono } from "hono";
import { BusyError, ChatNotFoundError, type ChatService } from "./chat-service.js";

async function jsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await c.req.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function handleError(c: Context, error: unknown): Response {
  if (error instanceof BusyError) return c.json({ error: "busy" }, 409);
  if (error instanceof ChatNotFoundError) return c.json({ error: "not found" }, 404);
  throw error;
}

function param(c: Context, name: string): string {
  const value = c.req.param(name);
  // Set slugs and Pi session ids are plain tokens; reject anything path-like before touching the fs.
  if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new ChatNotFoundError();
  return value;
}

const MAX_QUOTE_CHARS = 4000;

export function chatRoutes(chats: ChatService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      return c.json(await chats.list(param(c, "set")));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/", async (c) => {
    try {
      return c.json({ id: await chats.create(param(c, "set")) }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/:id", async (c) => {
    try {
      return c.json(await chats.get(param(c, "set"), param(c, "id")));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/:id/messages", async (c) => {
    const body = await jsonObject(c);
    if (body === null || typeof body.text !== "string" || body.text.trim() === "") {
      return c.json({ error: "text is required" }, 400);
    }
    if (body.anchor !== undefined && typeof body.anchor !== "string") {
      return c.json({ error: "anchor must be a string" }, 400);
    }
    if (body.quote !== undefined) {
      if (typeof body.quote !== "string") {
        return c.json({ error: "quote must be a string" }, 400);
      }
      if (body.quote.length > MAX_QUOTE_CHARS) {
        return c.json({ error: `quote must be at most ${MAX_QUOTE_CHARS} characters` }, 400);
      }
    }
    try {
      await chats.send(
        param(c, "set"),
        param(c, "id"),
        body.text,
        body.anchor as string | undefined,
        body.quote as string | undefined,
      );
      return c.body(null, 202);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/:id/proposals", async (c) => {
    try {
      return c.json({ proposals: await chats.proposals(param(c, "set"), param(c, "id")) });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/:id/proposals/:proposalId", async (c) => {
    try {
      await chats.dismissProposal(param(c, "set"), param(c, "id"), param(c, "proposalId"));
      return c.body(null, 204);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/:id/abort", async (c) => {
    try {
      await chats.abort(param(c, "set"), param(c, "id"));
      return c.body(null, 204);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
