import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitPaths, ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import {
  approveCleanCards,
  CardStoreError,
  listCardFiles,
  markCardsExported,
  noteCommitSha,
  patchCard,
  readCardFile,
} from "./store.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
const SEP = "\u00b7";
const SET = "linear-algebra";
const CARD_REL = "cards/03-svd.md";
const NOTE_REL = "notes/03-svd.md";

let root: string;
let locks: FileLocks;

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
    `<!-- status: approved ${SEP} type: cloze ${SEP} critic: ok -->`,
    "**Text:** The {{c1::singular values}} of $A$ are non-negative.",
    "**Extra:** SVD.",
    "",
    "## c-deadbeef",
    "<!-- type: basic -->",
    "**Q:** missing status",
    "**A:** …",
    "",
  ].join("\n");
}

async function writeCards(text: string): Promise<void> {
  const dir = path.join(root, SET, "cards");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "03-svd.md"), text);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-cards-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
  locks = new FileLocks();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("listCardFiles", () => {
  it("lists card files with status counts and no stale flag when the note is unchanged", async () => {
    const noteSha = await noteCommitSha(root, `${SET}/${NOTE_REL}`);
    expect(noteSha).not.toBeNull();
    await writeCards(cardsText(noteSha as string));

    const files = await listCardFiles(root, SET);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: CARD_REL,
      note: NOTE_REL,
      deck: "Linear Algebra::SVD",
      stale: false,
      noteCommitsSince: 0,
      counts: { draft: 2, approved: 1, rejected: 0, exported: 0 },
    });
  });

  it("flags a card file stale once the note gets a newer commit", async () => {
    const noteSha = await noteCommitSha(root, `${SET}/${NOTE_REL}`);
    await writeCards(cardsText(noteSha as string));

    const notePath = path.join(root, SET, NOTE_REL);
    await fs.appendFile(notePath, "\nA new paragraph.\n");
    await commitPaths(root, [`${SET}/${NOTE_REL}`], "user: edit note", "user");

    const files = await listCardFiles(root, SET);
    expect(files[0]).toMatchObject({ stale: true, noteCommitsSince: 1 });
  });

  it("reports invalid frontmatter per file without blocking valid card files", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));
    await fs.writeFile(path.join(root, SET, "cards/02-broken.md"), "---\ndeck: [unclosed\n---\n");

    const files = await listCardFiles(root, SET);

    expect(files[0]).toMatchObject({
      path: "cards/02-broken.md",
      counts: { draft: 0, approved: 0, rejected: 0, exported: 0 },
    });
    expect(files[0]?.error).toMatch(/invalid frontmatter YAML/);
    await expect(readCardFile(root, SET, "cards/02-broken.md")).resolves.toMatchObject({
      cards: [],
      error: expect.stringMatching(/invalid frontmatter YAML/),
    });
    await expect(patchCard(root, locks, SET, "c-91bd07e4", { status: "approved" })).resolves.toMatchObject({
      card: { id: "c-91bd07e4", status: "approved" },
    });
  });
});

describe("readCardFile", () => {
  it("returns card views and skips malformed sections", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));

    const detail = await readCardFile(root, SET, CARD_REL);
    expect(detail?.cards.map((card) => card.id)).toEqual(["c-8f3a1b2c", "c-91bd07e4", "c-abc12345"]);
    expect(detail?.cards[2]).toMatchObject({
      type: "cloze",
      status: "approved",
      text: "The {{c1::singular values}} of $A$ are non-negative.",
    });

    await expect(readCardFile(root, SET, "../PLAN.md")).rejects.toBeInstanceOf(CardStoreError);
    await expect(readCardFile(root, SET, "cards/99-missing.md")).resolves.toBeNull();
  });
});

describe("patchCard", () => {
  it("edits exactly one card section and commits as the user", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));

    const { card, commit } = await patchCard(root, locks, SET, "c-91bd07e4", { status: "approved" });
    expect(card).toMatchObject({ id: "c-91bd07e4", status: "approved" });
    expect(commit.sha).not.toBeNull();

    const text = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");
    expect(text).toContain(`<!-- status: approved ${SEP} type: basic -->`);
    expect(text).toContain(`<!-- status: draft ${SEP} type: basic ${SEP} critic: ok -->`);
    expect(text).toContain("## c-deadbeef\n<!-- type: basic -->");

    const commits = await log(root, { limit: 1 });
    expect(commits[0]).toMatchObject({ author: "user", subject: "user: update card c-91bd07e4" });
  });

  it("edits a body field in place without touching the other cards", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));

    const { card } = await patchCard(root, locks, SET, "c-8f3a1b2c", { a: "Rewritten answer." });
    expect(card.a).toBe("Rewritten answer.");

    const text = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");
    expect(text).toContain("**A:** Rewritten answer.");
    expect(text).toContain("**Q:** Unreviewed question?");
  });

  it("reports malformed and unknown cards", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));
    await expect(patchCard(root, locks, SET, "c-deadbeef", { status: "approved" })).rejects.toMatchObject({
      code: "malformed",
    });
    await expect(patchCard(root, locks, SET, "c-00000000", { status: "approved" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("approveCleanCards", () => {
  it("approves only draft cards whose critic verdict is ok", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));

    const { approved, commit } = await approveCleanCards(root, locks, SET, CARD_REL);
    expect(approved).toBe(1);
    expect(commit.sha).not.toBeNull();

    const text = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");
    expect(text).toContain(`<!-- status: approved ${SEP} type: basic ${SEP} critic: ok -->`);
    expect(text).toContain(`<!-- status: draft ${SEP} type: basic -->`);
  });
});

describe("markCardsExported", () => {
  it("records the Anki note id and flips approved cards to exported", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));

    const { updated, commit } = await markCardsExported(root, locks, SET, ["c-abc12345"], { "c-abc12345": 1712345678 });
    expect(updated).toBe(1);
    expect(commit.sha).not.toBeNull();

    const text = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");
    expect(text).toContain(`status: exported ${SEP} type: cloze ${SEP} critic: ok ${SEP} anki: 1712345678`);
  });

  it("refuses to export cards that are not approved", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));
    await expect(markCardsExported(root, locks, SET, ["c-91bd07e4"])).rejects.toMatchObject({ code: "invalid" });
  });

  it("does not leave earlier files changed when a later file cannot be edited exactly", async () => {
    await writeCards(cardsText("0000000000000000000000000000000000000000"));
    const duplicate = [
      "## c-feedface",
      `<!-- status: approved ${SEP} type: basic -->`,
      "**Q:** Duplicate?",
      "**A:** Yes.",
      "",
    ].join("\n");
    await fs.writeFile(
      path.join(root, SET, "cards/04-duplicate.md"),
      `---\ndeck: D\nnote: ${NOTE_REL}\nnote_sha: old\n---\n\n${duplicate}${duplicate}`,
    );
    const before = await fs.readFile(path.join(root, SET, CARD_REL), "utf8");

    await expect(markCardsExported(root, locks, SET, ["c-abc12345", "c-feedface"])).rejects.toThrow(
      /changed while marking cards exported/,
    );

    await expect(fs.readFile(path.join(root, SET, CARD_REL), "utf8")).resolves.toBe(before);
  });
});
