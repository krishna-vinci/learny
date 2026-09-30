import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SearchResponse } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatService } from "../agent/chat-service.js";
import { EventHub } from "../events.js";
import { JobRunner } from "../jobs/runner.js";
import { McpManager } from "../mcp/bridge.js";
import { openSearchIndex, type SearchIndex } from "../search/index.js";
import { FileLocks } from "../tree/lock.js";
import { searchRoutes } from "./search.js";

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
let root: string;
let index: SearchIndex;
let app: Hono;
let outside: string | undefined;

async function writeChat(set: string, name?: string): Promise<void> {
  const dir = path.join(root, set, "chats");
  await fs.mkdir(dir, { recursive: true });
  const timestamp = "2026-09-30T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id: "chat-1234", timestamp, cwd: root },
    {
      type: "message",
      id: "message-1",
      parentId: null,
      timestamp,
      message: {
        role: "user",
        content: [{ type: "text", text: "Matrix intuition" }],
        timestamp: Date.parse(timestamp),
      },
    },
    {
      type: "message",
      id: "message-2",
      parentId: "message-1",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Privatequasar transcript body" }],
        timestamp: Date.parse(timestamp),
      },
    },
    ...(name === undefined ? [] : [{ type: "session_info", id: "name-1", parentId: "message-2", timestamp, name }]),
  ];
  await fs.writeFile(
    path.join(dir, "2026-09-30_chat-1234.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-search-route-"));
  await fs.cp(SAMPLE, root, { recursive: true });
  index = openSearchIndex(root);
  await index.rebuildAll();
  const hub = new EventHub();
  const chats = new ChatService({
    root,
    hub,
    locks: new FileLocks(),
    mcp: new McpManager([]),
    runtime: {} as ConstructorParameters<typeof ChatService>[0]["runtime"],
    jobs: new JobRunner({ root, hub, maxParallel: 1 }),
  });
  app = new Hono();
  app.route("/api/search", searchRoutes({ root, index, chats }));
});

afterEach(async () => {
  await index.close();
  await fs.rm(root, { recursive: true, force: true });
  if (outside !== undefined) await fs.rm(outside, { recursive: true, force: true });
  outside = undefined;
});

async function search(params: Record<string, string>): Promise<SearchResponse> {
  const response = await app.request(`/api/search?${new URLSearchParams(params)}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<SearchResponse>;
}

describe("GET /api/search", () => {
  it("returns ranked search results with filters, snippets and limits", async () => {
    const { results } = await search({
      q: "singular value decompos",
      set: "linear-algebra",
      kind: "note,source",
      limit: "1",
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "note",
      set: "linear-algebra",
      path: "linear-algebra/notes/03-svd.md",
      title: "Singular value decomposition",
      score: expect.any(Number),
    });
    expect(results[0]?.snippet).toContain("[[");
    expect((await search({ q: "decompos", kind: "source" })).results).toEqual([
      expect.objectContaining({ kind: "source", set: null }),
    ]);
    expect((await search({ q: "decompos", set: "missing-set" })).results).toEqual([]);
    const repeated = await app.request("/api/search?q=decompos&kind=note&kind=source");
    expect(((await repeated.json()) as SearchResponse).results).toHaveLength(2);
  });

  it("rejects missing or oversized queries, invalid kinds, set paths and limits", async () => {
    for (const query of [
      "",
      "q=x&limit=0",
      "q=x&limit=51",
      "q=x&limit=1.5",
      "q=x&limit=NaN",
      "q=x&kind=unknown",
      "q=x&set=../bob",
      `q=${"x".repeat(201)}`,
    ]) {
      expect((await app.request(`/api/search?${query}`)).status).toBe(400);
    }
    expect((await search({ q: "" })).results).toEqual([]);
    expect((await search({ q: '"* NEAR( )' })).results).toEqual([]);
    expect((await search({ q: "x".repeat(200), limit: "50" })).results).toEqual([]);
  });

  it("searches current chat titles case-insensitively and ranks them below FTS hits", async () => {
    await writeChat("linear-algebra", "Singular value decomposition discussion");
    const { results } = await search({ q: "singular value decomposition" });
    expect(results.at(-1)).toMatchObject({
      kind: "chat",
      set: "linear-algebra",
      path: "linear-algebra/chats/chat-1234",
      title: "Singular value decomposition discussion",
    });
    expect(results[0]?.score).toBeGreaterThan(results.at(-1)?.score ?? 0);
    expect((await search({ q: "VALUE DECOMPOSITION", kind: "chat" })).results).toHaveLength(1);
    expect((await search({ q: "privatequasar" })).results).toEqual([]);
    expect(index.query({ q: "discussion", kinds: ["chat"], limit: 50 })).toEqual([]);
    await writeChat("linear-algebra", "Renamed conversation");
    expect((await search({ q: "discussion", kind: "chat" })).results).toEqual([]);
    expect((await search({ q: "renamed", kind: "chat" })).results).toHaveLength(1);
    await writeChat("linear-algebra");
    expect((await search({ q: "matrix intuition", kind: "chat" })).results).toEqual([
      expect.objectContaining({ title: "Matrix intuition" }),
    ]);
  });

  it("honors the set/kind filter for chats and applies the limit after merging", async () => {
    await writeChat("linear-algebra", "Singular value decomposition");
    await fs.mkdir(path.join(root, "other"));
    await fs.writeFile(path.join(root, "other/PLAN.md"), "---\ntitle: Other\n---\n");
    await writeChat("other", "Singular value decomposition");
    expect((await search({ q: "singular value", kind: "chat" })).results).toHaveLength(2);
    expect((await search({ q: "singular value", kind: "chat", set: "other" })).results).toEqual([
      expect.objectContaining({ set: "other" }),
    ]);
    expect(
      (await search({ q: "singular value", kind: "note" })).results.every((result) => result.kind === "note"),
    ).toBe(true);
    const { results } = await search({ q: "singular value", limit: "1" });
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("note");
    await fs.rm(path.join(root, "other/chats"), { recursive: true });
    expect((await search({ q: "singular value", kind: "chat", set: "other" })).results).toEqual([]);
  });

  it("never reads chat metadata through symlinks outside the workspace", async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-search-chat-outside-"));
    await writeChat("linear-algebra", "Confidentialquasar");
    const chatDir = path.join(root, "linear-algebra/chats");
    await fs.cp(chatDir, outside, { recursive: true });
    await fs.rm(chatDir, { recursive: true });
    await fs.symlink(outside, chatDir);
    expect((await search({ q: "confidentialquasar", kind: "chat" })).results).toEqual([]);
    await fs.rm(chatDir);
    await fs.mkdir(chatDir);
    await fs.symlink(path.join(outside, "2026-09-30_chat-1234.jsonl"), path.join(chatDir, "escape.jsonl"));
    expect((await search({ q: "confidentialquasar", kind: "chat" })).results).toEqual([]);
  });
});
