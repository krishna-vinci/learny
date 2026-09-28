import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnkiClient, NewAnkiNote, StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { ankiRoutes } from "./anki.js";

const SEP = "\u00b7";
const SET = "linear-algebra";
const CARD_REL = "cards/03-svd.md";

const CARD_FILE = [
  "---",
  "deck: Linear Algebra::SVD",
  "note: notes/03-svd.md",
  "note_sha: abc123",
  "---",
  "",
  "## c-8f3a1b2c",
  `<!-- status: approved ${SEP} type: basic ${SEP} src: lib-strang-la#p364 ${SEP} critic: ok -->`,
  "**Q:** What is $A$?",
  "**A:** A matrix.",
  "",
  "## c-91bd07e4",
  `<!-- status: exported ${SEP} type: cloze ${SEP} critic: ok -->`,
  "**Text:** $A$ has {{c1::left}} and {{c2::right}} singular vectors.",
  "**Extra:** Two sides.",
  "",
  "## c-deadbeef",
  `<!-- status: draft ${SEP} type: basic ${SEP} critic: ok -->`,
  "**Q:** Draft?",
  "**A:** Not yet.",
  "",
].join("\n");

interface FakeAnki {
  client: AnkiClient;
  addedNotes: NewAnkiNote[];
  updates: { noteId: number; fields: Record<string, string> }[];
  createdDecks: string[];
}

function fakeClient(existing: Record<string, number>): FakeAnki {
  const addedNotes: NewAnkiNote[] = [];
  const updates: { noteId: number; fields: Record<string, string> }[] = [];
  const createdDecks: string[] = [];
  let nextNoteId = 9001;
  const client: AnkiClient = {
    version: async () => 6,
    modelNames: async () => ["Studium Basic", "Studium Cloze"],
    deckNames: async () => ["Default"],
    createModel: async () => ({ id: 1 }),
    createDeck: async (deck) => {
      createdDecks.push(deck);
      return 1;
    },
    findNotes: async (query) => {
      const noteId = existing[query.slice("CardId:".length)];
      return noteId === undefined ? [] : [noteId];
    },
    notesInfo: async () => [],
    addNotes: async (notes) => {
      addedNotes.push(...notes);
      return notes.map(() => nextNoteId++);
    },
    updateNoteFields: async (noteId, fields) => {
      updates.push({ noteId, fields });
    },
  };
  return { client, addedNotes, updates, createdDecks };
}

let root: string;
let hub: EventHub;

function makeApp(options: { env: NodeJS.ProcessEnv; client?: AnkiClient }): Hono {
  const app = new Hono();
  app.route(
    `/api/sets/:set/anki`,
    ankiRoutes({
      root,
      locks: new FileLocks(),
      hub,
      env: options.env,
      ...(options.client === undefined ? {} : { client: options.client }),
    }),
  );
  return app;
}

async function cardsText(): Promise<string> {
  return fs.readFile(path.join(root, SET, CARD_REL), "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-anki-route-"));
  await fs.mkdir(path.join(root, SET, "cards"), { recursive: true });
  await fs.mkdir(path.join(root, SET, "notes"), { recursive: true });
  await fs.mkdir(path.join(root, "library/lib-strang-la"), { recursive: true });
  await fs.writeFile(path.join(root, SET, "PLAN.md"), "---\ntitle: Linear algebra\n---\n");
  await fs.writeFile(path.join(root, SET, "notes/03-svd.md"), "---\ntitle: SVD\n---\n");
  await fs.writeFile(path.join(root, SET, CARD_REL), CARD_FILE);
  await fs.writeFile(
    path.join(root, "library/lib-strang-la/source.md"),
    "---\nid: lib-strang-la\ntitle: Introduction to Linear Algebra\n---\n",
  );
  await ensureRepo(root);
  hub = new EventHub();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("anki sync route", () => {
  it("returns 503 when ANKICONNECT_URL is not set", async () => {
    const app = makeApp({ env: {}, client: fakeClient({}).client });
    const response = await app.request(`/api/sets/${SET}/anki/sync`, { method: "POST" });
    expect(response.status).toBe(503);
  });

  it("returns 404 for an unknown set", async () => {
    const app = makeApp({ env: { ANKICONNECT_URL: "http://localhost:8765" }, client: fakeClient({}).client });
    const response = await app.request("/api/sets/nope/anki/sync", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("adds new notes, updates existing ones, and marks cards exported", async () => {
    const fake = fakeClient({ "c-91bd07e4": 1234 });
    const app = makeApp({ env: { ANKICONNECT_URL: "http://localhost:8765" }, client: fake.client });
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));

    const response = await app.request(`/api/sets/${SET}/anki/sync`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: 1, updated: 1, failed: [] });

    expect(fake.createdDecks).toEqual([`Studium::${SET}::03-svd`]);
    expect(fake.addedNotes).toHaveLength(1);
    expect(fake.addedNotes[0]).toMatchObject({
      deckName: `Studium::${SET}::03-svd`,
      modelName: "Studium Basic",
      fields: {
        CardId: "c-8f3a1b2c",
        Front: "<p>What is \\(A\\)?</p>",
        Source: "Introduction to Linear Algebra — p364",
      },
    });
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]?.noteId).toBe(1234);
    expect(fake.updates[0]?.fields.Text).toContain("{{c1::");

    const text = await cardsText();
    expect(text).toContain(
      `<!-- status: exported ${SEP} type: basic ${SEP} src: lib-strang-la#p364 ${SEP} critic: ok ${SEP} anki: 9001 -->`,
    );
    expect(text).toContain("anki: 1234");
    expect(text).toContain(`<!-- status: draft ${SEP} type: basic ${SEP} critic: ok -->`);
    expect(events).toContainEqual(expect.objectContaining({ type: "commit", author: "user" }));
  });

  it("rejects a malformed card path", async () => {
    const app = makeApp({ env: { ANKICONNECT_URL: "http://localhost:8765" }, client: fakeClient({}).client });
    const response = await app.request(`/api/sets/${SET}/anki/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../PLAN.md" }),
    });
    expect(response.status).toBe(400);
  });
});
