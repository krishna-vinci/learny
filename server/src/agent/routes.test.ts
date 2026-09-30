import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ChatService } from "./chat-service.js";
import { chatRoutes } from "./routes.js";

const SET = "alpha";
const CHAT = "chat-1";

function build() {
  const send = vi.fn(async () => undefined);
  const dismissProposal = vi.fn(async () => undefined);
  const chats = {
    send,
    list: vi.fn(async () => []),
    create: vi.fn(async () => CHAT),
    get: vi.fn(async () => ({ id: CHAT, messages: [], running: false })),
    abort: vi.fn(async () => undefined),
    proposals: vi.fn(async () => [{ kind: "job_proposal", proposalId: "p1" }]),
    dismissProposal,
  } as unknown as ChatService;
  const app = new Hono();
  app.route("/api/sets/:set/chats", chatRoutes(chats));
  return { app, send, dismissProposal };
}

async function sendMessage(app: Hono, body: unknown): Promise<Response> {
  return await app.request(`/api/sets/${SET}/chats/${CHAT}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("chat routes", () => {
  it("passes the anchor and quoted passage through to the chat service", async () => {
    const { app, send } = build();
    const response = await sendMessage(app, {
      text: "Why?",
      anchor: "notes/03-vectors.md",
      quote: "A vector space is closed under addition.",
    });
    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith(
      SET,
      CHAT,
      "Why?",
      "notes/03-vectors.md",
      "A vector space is closed under addition.",
    );
  });

  it("rejects a quote that is not a string or exceeds 4000 characters", async () => {
    const { app, send } = build();

    const notAString = await sendMessage(app, { text: "Why?", quote: 42 });
    expect(notAString.status).toBe(400);

    const tooLong = await sendMessage(app, { text: "Why?", quote: "x".repeat(4001) });
    expect(tooLong.status).toBe(400);

    expect(send).not.toHaveBeenCalled();
  });

  it("lists and dismisses pending job proposals", async () => {
    const { app, dismissProposal } = build();

    const listed = await app.request(`/api/sets/${SET}/chats/${CHAT}/proposals`);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ proposals: [{ kind: "job_proposal", proposalId: "p1" }] });

    const dismissed = await app.request(`/api/sets/${SET}/chats/${CHAT}/proposals/p1`, { method: "DELETE" });
    expect(dismissed.status).toBe(204);
    expect(dismissProposal).toHaveBeenCalledWith(SET, CHAT, "p1");
  });
});
