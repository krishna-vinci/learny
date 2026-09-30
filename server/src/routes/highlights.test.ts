import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Highlight, StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { highlightsRoutes } from "./highlights.js";

const SET = "alpha";
const NOTE = "notes/03-vectors.md";
const HIGHLIGHTS_REL = `${SET}/highlights/03-vectors.md.json`;

let root: string;
let outside: string;
let app: Hono;
let hub: EventHub;
let events: StudiumEvent[];

async function json(method: "POST" | "PATCH", pathname: string, body: unknown): Promise<Response> {
  return await app.request(pathname, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function addHighlight(body: Record<string, unknown> | unknown): Promise<Response> {
  return await json("POST", `/api/sets/${SET}/highlights`, body);
}

function highlightBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    note: NOTE,
    quote: "A vector space is closed under addition.",
    prefix: "Definition. ",
    suffix: " Scalars too.",
    color: "yellow",
    ...overrides,
  };
}

async function storedHighlights(): Promise<Highlight[]> {
  return JSON.parse(await fs.readFile(path.join(root, HIGHLIGHTS_REL), "utf8")) as Highlight[];
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-highlights-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-highlights-outside-"));
  await fs.mkdir(path.join(root, `${SET}/notes`), { recursive: true });
  await fs.writeFile(
    path.join(root, `${SET}/PLAN.md`),
    '---\ntitle: "Alpha"\nstatus: active\nlevel: 1\nsources: []\nnext_action: Start\n---\n',
  );
  await fs.writeFile(
    path.join(root, SET, NOTE),
    "---\ntitle: Vectors\norder: 3\n---\n\n# Vectors\n\nA vector space is closed under addition.\n",
  );
  await ensureRepo(root);

  hub = new EventHub();
  events = [];
  hub.subscribe((event) => events.push(event));
  app = new Hono();
  app.route("/api/sets/:set/highlights", highlightsRoutes({ root, locks: new FileLocks(), hub }));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("highlights routes", () => {
  it("adds, lists, updates and deletes a highlight, committing each write as user", async () => {
    const created = await addHighlight(highlightBody({ comment: "Recall this." }));
    expect(created.status).toBe(201);
    const { highlight } = (await created.json()) as { highlight: Highlight };
    expect(highlight).toMatchObject({
      quote: "A vector space is closed under addition.",
      prefix: "Definition. ",
      suffix: " Scalars too.",
      color: "yellow",
      note: "Recall this.",
    });
    expect(highlight.id).toMatch(/^h-[0-9a-f]{8}$/);
    expect(Number.isNaN(Date.parse(highlight.createdAt))).toBe(false);
    await expect(storedHighlights()).resolves.toEqual([highlight]);

    const listed = await app.request(`/api/sets/${SET}/highlights?note=${NOTE}`);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ highlights: [highlight] });

    const patched = await json("PATCH", `/api/sets/${SET}/highlights/${highlight.id}`, {
      note: NOTE,
      color: "green",
      comment: "",
    });
    expect(patched.status).toBe(200);
    const { highlight: updated } = (await patched.json()) as { highlight: Highlight };
    expect(updated).toMatchObject({ id: highlight.id, color: "green" });
    expect(updated.note).toBeUndefined();
    await expect(storedHighlights()).resolves.toEqual([updated]);

    const deleted = await app.request(`/api/sets/${SET}/highlights/${highlight.id}?note=${NOTE}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    await expect(storedHighlights()).resolves.toEqual([]);
    const listAfterDelete = await app.request(`/api/sets/${SET}/highlights?note=${NOTE}`);
    await expect(listAfterDelete.json()).resolves.toEqual({ highlights: [] });

    const commits = await log(root, { limit: 10 });
    expect(commits.filter((commit) => commit.subject === "user: highlight Vectors")).toHaveLength(2);
    expect(commits.filter((commit) => commit.subject === "user: remove highlight Vectors")).toHaveLength(1);
    expect(commits.filter((commit) => commit.subject.includes("highlight")).map((commit) => commit.author)).toEqual([
      "user",
      "user",
      "user",
    ]);
    expect(events.filter((event) => event.type === "commit" && event.author === "user")).toHaveLength(3);
  });

  it("returns an empty list when a note has no highlights yet", async () => {
    const response = await app.request(`/api/sets/${SET}/highlights?note=${NOTE}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ highlights: [] });
    await expect(fs.access(path.join(root, HIGHLIGHTS_REL))).rejects.toThrow();
  });

  it("rejects note paths outside notes/ and missing notes", async () => {
    for (const note of ["../01-escaped.md", "notes/../../etc/passwd", "cards/03-vectors.md", "notes/03-vectors.txt"]) {
      const listed = await app.request(`/api/sets/${SET}/highlights?note=${encodeURIComponent(note)}`);
      expect(listed.status, note).toBe(400);
      const created = await addHighlight(highlightBody({ note }));
      expect(created.status, note).toBe(400);
    }

    const missing = await addHighlight(highlightBody({ note: "notes/99-absent.md" }));
    expect(missing.status).toBe(404);
    const missingList = await app.request(`/api/sets/${SET}/highlights?note=notes/99-absent.md`);
    expect(missingList.status).toBe(404);
  });

  it("enforces the field and per-note limits", async () => {
    expect((await addHighlight(highlightBody({ quote: "x".repeat(2001) }))).status).toBe(400);
    expect((await addHighlight(highlightBody({ quote: "   " }))).status).toBe(400);
    expect((await addHighlight(highlightBody({ prefix: "x".repeat(65) }))).status).toBe(400);
    expect((await addHighlight(highlightBody({ suffix: "x".repeat(65) }))).status).toBe(400);
    expect((await addHighlight(highlightBody({ comment: "x".repeat(1001) }))).status).toBe(400);
    expect((await addHighlight(highlightBody({ color: "orange" }))).status).toBe(400);

    const full: Highlight[] = Array.from({ length: 500 }, (_value, index) => ({
      id: `h-${index.toString(16).padStart(8, "0")}`,
      quote: `quote ${index}`,
      prefix: "",
      suffix: "",
      color: "blue",
      createdAt: new Date(0).toISOString(),
    }));
    await fs.mkdir(path.dirname(path.join(root, HIGHLIGHTS_REL)), { recursive: true });
    await fs.writeFile(path.join(root, HIGHLIGHTS_REL), `${JSON.stringify(full, null, 2)}\n`);

    const overflow = await addHighlight(highlightBody());
    expect(overflow.status).toBe(409);
    expect(await storedHighlights()).toHaveLength(500);
  });

  it("404s on an unknown highlight id and rejects a bad id", async () => {
    const created = await addHighlight(highlightBody());
    const { highlight } = (await created.json()) as { highlight: Highlight };

    expect((await json("PATCH", `/api/sets/${SET}/highlights/h-00000000`, { note: NOTE, color: "pink" })).status).toBe(
      404,
    );
    expect((await app.request(`/api/sets/${SET}/highlights/not-an-id?note=${NOTE}`, { method: "DELETE" })).status).toBe(
      400,
    );
    await expect(storedHighlights()).resolves.toEqual([highlight]);
  });
});
