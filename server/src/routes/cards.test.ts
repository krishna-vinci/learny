import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CardFileDetail, CardFileView, CardView, StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noteCommitSha } from "../cards/store.js";
import { EventHub } from "../events.js";
import { commitPaths, ensureRepo } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { cardsRoutes } from "./cards.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
const SEP = "\u00b7";
const SET = "linear-algebra";
const CARD_REL = "cards/03-svd.md";
const NOTE_REL = "notes/03-svd.md";

let root: string;
let app: Hono;
let hub: EventHub;

function cardsText(noteSha: string): string {
  return [
    "---",
    "deck: Linear Algebra::SVD",
    `note: ${NOTE_REL}`,
    `note_sha: ${noteSha}`,
    "---",
    "",
    "## c-8f3a1b2c",
    `<!-- status: draft ${SEP} type: basic ${SEP} critic: ok -->`,
    "**Q:** What does the SVD factor $A$ into?",
    "**A:** $A = U\\Sigma V^\\top$.",
    "",
    "## c-91bd07e4",
    `<!-- status: draft ${SEP} type: basic -->`,
    "**Q:** Unreviewed question?",
    "**A:** Not yet reviewed.",
    "",
    "## c-abc12345",
    `<!-- status: approved ${SEP} type: cloze -->`,
    "**Text:** The {{c1::singular values}} of $A$ are non-negative.",
    "**Extra:** SVD.",
    "",
  ].join("\n");
}

async function writeCards(text: string): Promise<void> {
  const dir = path.join(root, SET, "cards");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "03-svd.md"), text);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-cards-routes-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
  hub = new EventHub();
  app = new Hono();
  app.route("/api/sets/:set/cards", cardsRoutes({ root, locks: new FileLocks(), hub }));
  const noteSha = (await noteCommitSha(root, `${SET}/${NOTE_REL}`)) ?? "0000000000000000000000000000000000000000";
  await writeCards(cardsText(noteSha));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("cards routes", () => {
  it("lists card files for a set", async () => {
    const response = await app.request(`/api/sets/${SET}/cards`);
    expect(response.status).toBe(200);
    const files = (await response.json()) as CardFileView[];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: CARD_REL,
      note: NOTE_REL,
      stale: false,
      counts: { draft: 2, approved: 1, rejected: 0, exported: 0 },
    });
  });

  it("returns 404 for an unknown set", async () => {
    const response = await app.request("/api/sets/nope/cards");
    expect(response.status).toBe(404);
  });

  it("reads one card file and rejects a bad path", async () => {
    const response = await app.request(`/api/sets/${SET}/cards/file?path=${CARD_REL}`);
    expect(response.status).toBe(200);
    const detail = (await response.json()) as CardFileDetail;
    expect(detail.cards.map((card) => card.id)).toEqual(["c-8f3a1b2c", "c-91bd07e4", "c-abc12345"]);

    expect((await app.request(`/api/sets/${SET}/cards/file?path=../PLAN.md`)).status).toBe(400);
    expect((await app.request(`/api/sets/${SET}/cards/file`)).status).toBe(400);
    expect((await app.request(`/api/sets/${SET}/cards/file?path=cards/99-missing.md`)).status).toBe(404);
  });

  it("patches a card, commits as user, and publishes the commit", async () => {
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));

    const response = await app.request(`/api/sets/${SET}/cards/c-91bd07e4`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as CardView).toMatchObject({ id: "c-91bd07e4", status: "approved" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "commit", author: "user", subject: "user: update card c-91bd07e4" }),
    );

    const text = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");
    expect(text).toContain(`<!-- status: approved ${SEP} type: basic -->`);
  });

  it("rejects an invalid status and an unknown card", async () => {
    const bad = await app.request(`/api/sets/${SET}/cards/c-91bd07e4`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "exported" }),
    });
    expect(bad.status).toBe(400);

    const missing = await app.request(`/api/sets/${SET}/cards/c-00000000`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(missing.status).toBe(404);

    const shortId = await app.request(`/api/sets/${SET}/cards/c-abcde`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(shortId.status).toBe(400);
    await expect(shortId.json()).resolves.toEqual({
      error: "card id must match c- followed by 8 lowercase hex characters",
    });
  });

  it("rejects a cloze edit that removes every deletion", async () => {
    const response = await app.request(`/api/sets/${SET}/cards/c-abc12345`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "The singular values are non-negative." }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Cloze card c-abc12345 requires at least one {{cN::}} deletion",
    });
  });

  it("approves every critic-clean draft", async () => {
    const response = await app.request(`/api/sets/${SET}/cards/approve-clean`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: CARD_REL }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approved: 1 });
  });

  it("marks exported cards with their Anki ids", async () => {
    const response = await app.request(`/api/sets/${SET}/cards/exported`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["c-abc12345"], ankiIds: { "c-abc12345": 1712345678 } }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: 1 });

    const text = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");
    expect(text).toContain(`status: exported ${SEP} type: cloze`);
    expect(text).toContain("anki: 1712345678");
  });

  it("rejects every malformed ankiIds key or value instead of dropping it", async () => {
    const requests = [
      { ids: ["c-abc12345"], ankiIds: { "c-abc12345": "9001" } },
      { ids: ["c-abc12345"], ankiIds: { "c-short": 9001 } },
      { ids: ["c-abc12345"], ankiIds: { "c-deadbeef": 9001 } },
    ];

    for (const body of requests) {
      const response = await app.request(`/api/sets/${SET}/cards/exported`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });

  it("flags stale card files after the note changes", async () => {
    await fs.appendFile(path.join(root, SET, NOTE_REL), "\nA new paragraph.\n");
    await commitPaths(root, [`${SET}/${NOTE_REL}`], "user: edit note", "user");

    const response = await app.request(`/api/sets/${SET}/cards`);
    const files = (await response.json()) as CardFileView[];
    expect(files[0]).toMatchObject({ stale: true, noteCommitsSince: 1 });
  });
});
