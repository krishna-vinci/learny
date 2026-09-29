import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { exportRoutes } from "./export.js";

let root: string;
let app: Hono;

const CARD_FILE = `---
deck: Linear Algebra::SVD
note: notes/03-svd.md
note_sha: abc123
---

## c-8f3a1b2c
<!-- status: approved · type: basic · src: lib-strang-la#p364 · critic: ok -->
**Q:** What is $A$?
**A:** A matrix.

## c-91bd07e4
<!-- status: exported · type: cloze · critic: ok -->
**Text:** $A$ has {{c1::left}} and {{c2::right}} singular vectors.
**Extra:** Two sides.

## c-deadbeef
<!-- status: rejected · type: basic · critic: rule 4 -->
**Q:** Rejected?
**A:** Yes.
`;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-export-route-"));
  await fs.mkdir(path.join(root, "linear-algebra/cards"), { recursive: true });
  await fs.mkdir(path.join(root, "linear-algebra/notes"), { recursive: true });
  await fs.mkdir(path.join(root, "library/lib-strang-la"), { recursive: true });
  await fs.writeFile(path.join(root, "linear-algebra/PLAN.md"), "---\ntitle: Linear algebra\n---\n");
  await fs.writeFile(path.join(root, "linear-algebra/notes/03-svd.md"), "---\ntitle: SVD\n---\n");
  await fs.writeFile(path.join(root, "linear-algebra/cards/03-svd.md"), CARD_FILE);
  await fs.writeFile(
    path.join(root, "library/lib-strang-la/source.md"),
    "---\nid: lib-strang-la\ntitle: Introduction to Linear Algebra\n---\n",
  );
  await ensureRepo(root);
  app = new Hono();
  app.route(
    "/api/sets/:set",
    exportRoutes({ root, locks: new FileLocks(), hub: new EventHub(), baseUrl: "https://studium.example" }),
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function packageGuids(response: Response): Promise<string[]> {
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
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

describe("GET /api/sets/:set/export.apkg", () => {
  it("downloads approved cards, then marks only those cards exported in a user commit", async () => {
    const response = await app.request("/api/sets/linear-algebra/export.apkg");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="studium-linear-algebra.apkg"');
    await expect(packageGuids(response)).resolves.toEqual(["c-8f3a1b2c"]);

    const updated = await fs.readFile(path.join(root, "linear-algebra/cards/03-svd.md"), "utf8");
    expect(updated).toContain("## c-8f3a1b2c\n<!-- status: exported · type: basic");
    expect(updated).toContain("## c-91bd07e4\n<!-- status: exported · type: cloze");
    expect(updated).toContain("## c-deadbeef\n<!-- status: rejected · type: basic");
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({
      author: "user",
      subject: "user: mark 1 card exported",
    });
  });

  it("can re-export exported cards and apply the optional note filter", async () => {
    const response = await app.request(
      "/api/sets/linear-algebra/export.apkg?cards=approved%2Bexported&note=notes%2F03-svd.md",
    );

    expect(response.status).toBe(200);
    await expect(packageGuids(response)).resolves.toEqual(["c-8f3a1b2c", "c-91bd07e4"]);
  });

  it("mark=0 builds the package without changing card statuses or committing", async () => {
    const before = await fs.readFile(path.join(root, "linear-algebra/cards/03-svd.md"), "utf8");
    const head = (await log(root, { limit: 1 }))[0];

    const response = await app.request("/api/sets/linear-algebra/export.apkg?mark=0");

    expect(response.status).toBe(200);
    await expect(packageGuids(response)).resolves.toEqual(["c-8f3a1b2c"]);
    expect(await fs.readFile(path.join(root, "linear-algebra/cards/03-svd.md"), "utf8")).toBe(before);
    expect((await log(root, { limit: 1 }))[0]).toEqual(head);
  });

  it("rejects invalid filters and unknown sets", async () => {
    expect((await app.request("/api/sets/linear-algebra/export.apkg?cards=all")).status).toBe(400);
    expect((await app.request("/api/sets/linear-algebra/export.apkg?note=..%2FPLAN.md")).status).toBe(400);
    expect((await app.request("/api/sets/missing/export.apkg")).status).toBe(404);
  });

  it("returns 400 when a card section has a non-conforming id", async () => {
    await fs.writeFile(path.join(root, "linear-algebra/cards/03-svd.md"), CARD_FILE.replace("c-8f3a1b2c", "c-abcde"));

    const response = await app.request("/api/sets/linear-algebra/export.apkg?cards=approved%2Bexported");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/8 lowercase hex/) });
  });
});
