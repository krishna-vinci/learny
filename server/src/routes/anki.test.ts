import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnkiClient, StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import JSZip from "jszip";
import initSqlJs from "sql.js";
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
  stored: { filename: string; data: string }[];
  imported: string[];
  deleted: string[];
}

function fakeClient(existing: Record<string, number>): FakeAnki {
  const stored: { filename: string; data: string }[] = [];
  const imported: string[] = [];
  const deleted: string[] = [];
  let importedPackage = false;
  let nextNoteId = 9001;
  const added = new Map<string, number>();
  const client: AnkiClient = {
    version: async () => 6,
    findNotes: async (query) => {
      const id = query.slice("CardId:".length);
      if (importedPackage && existing[id] === undefined && !added.has(id)) added.set(id, nextNoteId++);
      const noteId = existing[id] ?? added.get(id);
      return noteId === undefined ? [] : [noteId];
    },
    storeMediaFile: async (filename, data) => {
      stored.push({ filename, data });
      return filename;
    },
    getMediaDirPath: async () => "/anki/media",
    importPackage: async (packagePath) => {
      imported.push(packagePath);
      importedPackage = true;
    },
    deleteMediaFile: async (filename) => {
      deleted.push(filename);
    },
  };
  return { client, stored, imported, deleted };
}

async function storedPackageGuids(data: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(Buffer.from(data, "base64"));
  const bytes = await zip.file("collection.anki2")?.async("uint8array");
  if (bytes === undefined) throw new Error("missing collection.anki2");
  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  try {
    return (db.exec("SELECT guid FROM notes ORDER BY guid")[0]?.values ?? []).map((row) => String(row[0]));
  } finally {
    db.close();
  }
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

  it("imports one package with card-id GUIDs, resolves note ids, and marks cards exported", async () => {
    const fake = fakeClient({ "c-91bd07e4": 1234 });
    const app = makeApp({ env: { ANKICONNECT_URL: "http://localhost:8765" }, client: fake.client });
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));

    const response = await app.request(`/api/sets/${SET}/anki/sync`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: 1, updated: 1, failed: [] });

    expect(fake.stored).toHaveLength(1);
    await expect(storedPackageGuids(fake.stored[0]?.data ?? "")).resolves.toEqual(["c-8f3a1b2c", "c-91bd07e4"]);
    expect(fake.imported).toEqual([`/anki/media/${fake.stored[0]?.filename}`]);
    expect(fake.deleted).toEqual([fake.stored[0]?.filename]);

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

  it("reports an invalid cloze individually without sending it to Anki", async () => {
    await fs.writeFile(
      path.join(root, SET, CARD_REL),
      CARD_FILE.replace("$A$ has {{c1::left}} and {{c2::right}} singular vectors.", "$A$ has singular vectors."),
    );
    const fake = fakeClient({});
    const app = makeApp({ env: { ANKICONNECT_URL: "http://localhost:8765" }, client: fake.client });

    const response = await app.request(`/api/sets/${SET}/anki/sync`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      added: 1,
      updated: 0,
      failed: [{ id: "c-91bd07e4", error: "Cloze card c-91bd07e4 requires at least one {{cN::}} deletion" }],
    });
    await expect(storedPackageGuids(fake.stored[0]?.data ?? "")).resolves.toEqual(["c-8f3a1b2c"]);
  });
});
