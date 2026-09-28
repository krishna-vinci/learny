import { createHash } from "node:crypto";
import JSZip from "jszip";
import initSqlJs, { type Database } from "sql.js";
import { describe, expect, it } from "vitest";
import { createApkg, type ExportCard, fieldChecksum } from "./apkg.js";

const CARDS: ExportCard[] = [
  {
    id: "c-8f3a1b2c",
    type: "basic",
    q: "What does **SVD** factor with $A$?",
    a: "It factors a matrix.",
    src: "lib-strang-la#p364",
    deck: "Studium::linear-algebra::03-svd",
    notePath: "notes/03-svd.md",
  },
  {
    id: "c-91bd07e4",
    type: "cloze",
    text: "The SVD factors $A$ into {{c1::$U\\Sigma$}} and {{c2::$V^\\top$}}; {{c1::left factors}} repeat.",
    extra: "Two distinct deletions.",
    deck: "Studium::linear-algebra::03-svd",
    notePath: "notes/03-svd.md",
  },
];

async function openPackage(bytes: Uint8Array): Promise<{ db: Database; media: string }> {
  const zip = await JSZip.loadAsync(bytes);
  const collection = zip.file("collection.anki2");
  const media = zip.file("media");
  expect(collection).not.toBeNull();
  expect(media).not.toBeNull();
  const SQL = await initSqlJs();
  return {
    db: new SQL.Database(await collection?.async("uint8array")),
    media: (await media?.async("string")) ?? "",
  };
}

function rows(db: Database, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? [];
}

function collectionJson(db: Database, column: "models" | "decks"): Record<string, Record<string, unknown>> {
  const value = rows(db, `SELECT ${column} FROM col`)[0]?.[0];
  if (typeof value !== "string") throw new Error(`Missing col.${column}`);
  return JSON.parse(value) as Record<string, Record<string, unknown>>;
}

describe("createApkg", () => {
  it("writes a schema-11 collection with stable identities and Anki-compatible card data", async () => {
    const first = await openPackage(
      await createApkg(CARDS, {
        set: "linear-algebra",
        baseUrl: "https://studium.example/",
        sourceLabels: { "lib-strang-la#p364": "Introduction to Linear Algebra — p364" },
        now: new Date("2026-09-29T10:00:00.000Z"),
      }),
    );
    const second = await openPackage(
      await createApkg(CARDS, {
        set: "linear-algebra",
        now: new Date("2026-09-30T10:00:00.000Z"),
      }),
    );

    try {
      expect(first.media).toBe("{}");
      expect(rows(first.db, "PRAGMA integrity_check")).toEqual([["ok"]]);
      expect(rows(first.db, "SELECT ver FROM col")).toEqual([[11]]);
      expect(rows(first.db, "SELECT guid FROM notes ORDER BY guid")).toEqual([["c-8f3a1b2c"], ["c-91bd07e4"]]);

      const models = collectionJson(first.db, "models");
      const modelFields = Object.values(models)
        .map((model) => ({
          name: model.name,
          fields: (model.flds as Array<{ name: string }>).map((field) => field.name),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(modelFields).toEqual([
        { name: "Studium Basic", fields: ["Front", "Back", "CardId", "Source", "NoteLink"] },
        { name: "Studium Cloze", fields: ["Text", "Extra", "CardId", "Source", "NoteLink"] },
      ]);

      const decks = collectionJson(first.db, "decks");
      expect(Object.values(decks).map((deck) => deck.name)).toEqual(
        expect.arrayContaining(["Default", "Studium", "Studium::linear-algebra", "Studium::linear-algebra::03-svd"]),
      );

      const noteRows = rows(first.db, "SELECT guid, flds, sfld, csum, tags FROM notes ORDER BY guid");
      const basicFields = String(noteRows[0]?.[1]).split("\x1f");
      expect(basicFields[0]).toContain("\\(A\\)");
      expect(basicFields[3]).toBe("Introduction to Linear Algebra — p364");
      expect(basicFields[4]).toContain("https://studium.example/s/linear-algebra/n/03-svd.md");
      expect(noteRows[0]?.[2]).toBe(basicFields[0]);
      expect(noteRows[0]?.[3]).toBe(fieldChecksum(basicFields[0] ?? ""));
      expect(noteRows[0]?.[3]).toBe(
        Number.parseInt(
          createHash("sha1")
            .update(basicFields[0] ?? "")
            .digest("hex")
            .slice(0, 8),
          16,
        ),
      );
      expect(noteRows[0]?.[4]).toContain("src::lib-strang-la");

      const clozeFields = String(noteRows[1]?.[1]).split("\x1f");
      expect(clozeFields[0]).toContain("{{c1::\\(U\\Sigma\\)}}");
      expect(
        rows(
          first.db,
          "SELECT ord FROM cards WHERE nid = (SELECT id FROM notes WHERE guid = 'c-91bd07e4') ORDER BY ord",
        ),
      ).toEqual([[0], [1]]);
      expect(rows(first.db, "SELECT count(*) FROM cards")).toEqual([[3]]);
      expect(rows(first.db, "SELECT count(*) FROM revlog")).toEqual([[0]]);
      expect(rows(first.db, "SELECT count(*) FROM graves")).toEqual([[0]]);

      expect(rows(second.db, "SELECT id, guid, mid FROM notes ORDER BY guid")).toEqual(
        rows(first.db, "SELECT id, guid, mid FROM notes ORDER BY guid"),
      );
      expect(
        Object.values(collectionJson(second.db, "models"))
          .map((model) => [model.id, model.name])
          .sort(),
      ).toEqual(
        Object.values(models)
          .map((model) => [model.id, model.name])
          .sort(),
      );
      expect(
        Object.values(collectionJson(second.db, "decks"))
          .map((deck) => [deck.id, deck.name])
          .sort(),
      ).toEqual(
        Object.values(decks)
          .map((deck) => [deck.id, deck.name])
          .sort(),
      );
    } finally {
      first.db.close();
      second.db.close();
    }
  });
});
