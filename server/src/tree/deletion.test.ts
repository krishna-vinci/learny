import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCourse } from "../course/build.js";
import { seedPractice } from "../practice/practice.test-helper.js";
import { PracticeStore } from "../practice/store.js";
import { createNote } from "./authoring.js";
import { deleteFromTree, previewDeletion, recentlyDeleted, restoreDeletion } from "./deletion.js";
import { commitAll, ensureRepo, git, log } from "./git.js";
import { FileLocks } from "./lock.js";

let root: string;
let outside: string;
let locks: FileLocks;
const note = "notes/07-old-name.md";
const curriculum =
  "# Course\r\n- [x] 01 — Vectors\r\n  Scope: Intuition\r\n  Visual: diagram — vectors\r\n  Video: vector addition\r\n- [ ] 02 — Matrices\r\n";
async function put(rel: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
}
async function bytes(rel: string) {
  return fs.readFile(path.join(root, rel));
}
async function exists(rel: string) {
  return fs.access(path.join(root, rel)).then(
    () => true,
    () => false,
  );
}
async function remove(path?: string, options: { removeFromPlan?: boolean } = {}) {
  const target = { set: "alpha", ...(path ? { path } : {}) };
  const preview = await previewDeletion(root, locks, target);
  return deleteFromTree(root, locks, target, {
    token: preview.token,
    confirmation: preview.title,
    linkedDataConfirmed: true,
    ...options,
  });
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-delete-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-delete-outside-"));
  locks = new FileLocks();
  await put(".gitignore", "*/chats/\n**/original.*\n.cache/\n");
  await put("alpha/PLAN.md", "---\ntitle: Alpha\nstatus: active\nsources: []\n---\n");
  await put("alpha/curriculum.md", curriculum);
  await put(
    `alpha/${note}`,
    '---\r\ntitle: Renamed note\r\nchapter: vectors\r\norder: 7\r\n---\r\n# Renamed\r\n![Unique](../assets/unique.png)\r\n![Shared](../assets/shared.svg)\r\n::visual{src="../visuals/vector.html" title="Explore"}\r\n',
  );
  await put("alpha/notes/01-test.md", "---\ntitle: A test\norder: 1\n---\n![Shared][s]\n[s]: ../assets/shared.svg\n");
  await put(
    "alpha/cards/99-different-name.md",
    `---\nnote: ${note}\ndeck: Alpha::Vectors\n---\n## c-12345678\n<!-- status: exported · type: basic · anki: 123 -->\n**Q:** Q\n**A:** A\n`,
  );
  await put("alpha/assets/unique.png", Buffer.from([0, 255, 10, 1]));
  await put("alpha/assets/unique.json", '{"license":"CC0"}\n');
  await put("alpha/assets/shared.svg", "<svg>shared</svg>\n");
  await put(
    "alpha/visuals/vector.html",
    '<script id="studium-visual" type="application/json">{"poster":"vector.svg","posters":[{"src":"scene.svg","narration":"One"}]}</script>\n',
  );
  await put("alpha/visuals/vector.svg", "<svg>poster</svg>\n");
  await put("alpha/visuals/scene.svg", "<svg>scene</svg>\n");
  await put("alpha/media/01-vectors.md", "---\nchapter: Vectors\n---\nbrief\n");
  await put("alpha/highlights/07-old-name.md.json", '[{"quote":"text"}]\n');
  await put("alpha/practice/weak-spots.json", "[]\n");
  await put("alpha/chats/private.jsonl", "PRIVATE CHAT\n");
  await put("alpha/original.pdf", "PRIVATE ORIGINAL\n");
  await put("beta/PLAN.md", "---\ntitle: Beta\n---\n");
  await put("library/lib-test/parsed.md", "SOURCE\n");
  await put("_global/profile.md", "PROFILE\n");
  await ensureRepo(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("recoverable deletion", () => {
  it("deletes a chapter by identity, its cards/brief/highlights and exclusive media; restores exact bytes", async () => {
    const owned = [
      `alpha/${note}`,
      "alpha/cards/99-different-name.md",
      "alpha/assets/unique.png",
      "alpha/assets/unique.json",
      "alpha/visuals/vector.html",
      "alpha/visuals/vector.svg",
      "alpha/visuals/scene.svg",
      "alpha/media/01-vectors.md",
      "alpha/highlights/07-old-name.md.json",
    ];
    const before = await Promise.all(owned.map(bytes));
    const result = await remove(note);
    expect(result.preview).toMatchObject({
      chapter: true,
      exportedCards: 1,
      cardFiles: 1,
      mediaFiles: 6,
      files: 9,
      practiceHistoryKept: true,
    });
    expect(await Promise.all(owned.map(exists))).toEqual(owned.map(() => false));
    expect(await bytes("alpha/curriculum.md")).toEqual(Buffer.from(curriculum));
    expect(await exists("alpha/assets/shared.svg")).toBe(true);
    expect(await exists("alpha/practice/weak-spots.json")).toBe(true);
    const course = await buildCourse(root, "alpha");
    expect(course.chapters[0]).toMatchObject({ title: "Vectors", state: "planned" });
    expect(course.otherNotes?.map((n) => n.path)).toEqual(["notes/01-test.md"]);
    expect((await log(root, { limit: 1 }))[0]?.author).toBe("user");
    expect(await recentlyDeleted(root)).toMatchObject([{ sha: result.sha, kind: "note" }]);
    await restoreDeletion(root, locks, "alpha", result.sha);
    expect(await Promise.all(owned.map(bytes))).toEqual(before);
    expect(await recentlyDeleted(root)).toEqual([]);
  });

  it("keeps media including indirect posters when another note shares the visual", async () => {
    await put(
      "alpha/notes/01-test.md",
      '::visual{src="../visuals/vector.html" title="Shared"}\n![Image](../assets/shared.svg)\n',
    );
    const result = await remove(note);
    expect(result.preview.mediaFiles).toBe(3); // private raster + sidecar + brief
    for (const file of ["vector.html", "vector.svg", "scene.svg"])
      expect(await exists(`alpha/visuals/${file}`)).toBe(true);
  });

  it("offers removing only the matched curriculum row and indented brief, and undoes it", async () => {
    const result = await remove(note, { removeFromPlan: true });
    expect((await bytes("alpha/curriculum.md")).toString()).toBe("# Course\r\n- [ ] 02 — Matrices\r\n");
    expect((await buildCourse(root, "alpha")).chapters.map((c) => c.title)).toEqual(["Matrices"]);
    await restoreDeletion(root, locks, "alpha", result.sha);
    expect(await bytes("alpha/curriculum.md")).toEqual(Buffer.from(curriculum));
  });

  it("deletes an unmatched manual note without changing the numbered chapter or its brief", async () => {
    const result = await remove("notes/01-test.md");
    expect(result.preview.chapter).toBe(false);
    expect((await buildCourse(root, "alpha")).chapters[0]?.state).toBe("drafted");
    expect((await buildCourse(root, "alpha")).otherNotes).toEqual([]);
    expect(await exists("alpha/media/01-vectors.md")).toBe(true);
    await restoreDeletion(root, locks, "alpha", result.sha);
  });

  it("requires typed set confirmation, preserves ignored files and restores the entire set", async () => {
    const target = { set: "alpha" };
    const preview = await previewDeletion(root, locks, target);
    expect(preview.retainedIgnoredFiles).toBe(2);
    await expect(deleteFromTree(root, locks, target, { token: preview.token, confirmation: "alpha" })).rejects.toThrow(
      "Type the study set name",
    );
    const tracked = (await git(root, ["ls-files", "-z", "--", "alpha/"])).split("\0").filter(Boolean);
    const before = await Promise.all(tracked.map(bytes));
    const result = await remove();
    expect(await Promise.all(tracked.map(exists))).toEqual(tracked.map(() => false));
    expect(await exists("alpha/chats/private.jsonl")).toBe(true);
    expect(await exists("alpha/original.pdf")).toBe(true);
    expect(await exists("beta/PLAN.md")).toBe(true);
    expect(await exists("library/lib-test/parsed.md")).toBe(true);
    expect(await exists("_global/profile.md")).toBe(true);
    expect((await git(root, ["ls-files", "--", "alpha/"])).trim()).toBe("");
    await restoreDeletion(root, locks, "alpha", result.sha);
    expect(await Promise.all(tracked.map(bytes))).toEqual(before);
    const created = await createNote(root, locks, "alpha", "After restore");
    expect(await exists(`alpha/${created.path}`)).toBe(true);
  });

  it("captures untracked files and external edits before deletion so restore keeps the latest bytes", async () => {
    await put(`alpha/${note}`, "---\ntitle: Latest\nchapter: vectors\n---\nLatest unsaved bytes\n");
    await put("alpha/assets/unrelated.png", Buffer.from([250, 0, 1]));
    const expected = await bytes(`alpha/${note}`);
    const result = await remove(note);
    await restoreDeletion(root, locks, "alpha", result.sha);
    expect(await bytes(`alpha/${note}`)).toEqual(expected);
    const manual = await remove("notes/01-test.md");
    await restoreDeletion(root, locks, "alpha", manual.sha);
    expect(await exists("alpha/assets/unrelated.png")).toBe(true);
  });

  it("rejects stale previews, unconfirmed linked deletion, and an active task before mutating", async () => {
    const target = { set: "alpha", path: note };
    const preview = await previewDeletion(root, locks, target);
    await expect(deleteFromTree(root, locks, target, { token: preview.token })).rejects.toThrow("Confirm deletion");
    await put("alpha/notes/01-test.md", "changed\n");
    await expect(
      deleteFromTree(root, locks, target, { token: preview.token, linkedDataConfirmed: true }),
    ).rejects.toThrow("changed");
    const fresh = await previewDeletion(root, locks, target);
    await expect(
      deleteFromTree(root, locks, target, {
        token: fresh.token,
        assertIdle: () => {
          throw new Error("busy");
        },
      }),
    ).rejects.toThrow("busy");
    expect(await exists(`alpha/${note}`)).toBe(true);
  });

  it("waits for file lock contention and does not restore over re-created content", async () => {
    let release!: () => void;
    const held = locks.withLock(
      `alpha/${note}`,
      "drafter",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await vi.waitFor(() => expect(locks.holderOf(`alpha/${note}`)).toBe("drafter"));
    let finished = false;
    const deleting = remove(note).then((r) => {
      finished = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(finished).toBe(false);
    release();
    await held;
    const result = await deleting;
    await put(`alpha/${note}`, "NEW NOTE\n");
    await expect(restoreDeletion(root, locks, "alpha", result.sha)).rejects.toThrow("New content");
    expect((await bytes(`alpha/${note}`)).toString()).toBe("NEW NOTE\n");
  });

  it("keeps a duplicate chapter's row/brief and rejects removing its plan entry", async () => {
    await put("alpha/notes/08-duplicate.md", "---\ntitle: Another\nchapter: vectors\n---\nDuplicate\n");
    const preview = await previewDeletion(root, locks, { set: "alpha", path: note });
    await expect(
      deleteFromTree(
        root,
        locks,
        { set: "alpha", path: note },
        { token: preview.token, linkedDataConfirmed: true, removeFromPlan: true },
      ),
    ).rejects.toThrow("Another note");
    await remove(note);
    expect(await exists("alpha/media/01-vectors.md")).toBe(true);
    expect((await buildCourse(root, "alpha")).chapters[0]?.path).toBe("notes/08-duplicate.md");
  });

  it("refuses a note restore until its containing set has been restored", async () => {
    const n = await remove(note);
    const s = await remove();
    await expect(restoreDeletion(root, locks, "alpha", n.sha)).rejects.toThrow("Restore the study set");
    await restoreDeletion(root, locks, "alpha", s.sha);
    await restoreDeletion(root, locks, "alpha", n.sha);
    expect(await exists(`alpha/${note}`)).toBe(true);
  });

  it("refuses staged unrelated work and reports conflicting later curriculum edits without changing them", async () => {
    const result = await remove(note, { removeFromPlan: true });
    await put("beta/PLAN.md", "STAGED\n");
    await git(root, ["add", "beta/PLAN.md"]);
    await expect(restoreDeletion(root, locks, "alpha", result.sha)).rejects.toThrow("staged");
    await commitAll(root, "user: unrelated", "user");
    await put("alpha/curriculum.md", "# NEW PLAN\n");
    await commitAll(root, "user: new plan", "user");
    await expect(restoreDeletion(root, locks, "alpha", result.sha)).rejects.toThrow("Revert");
    expect((await bytes("alpha/curriculum.md")).toString()).toBe("# NEW PLAN\n");
    expect(await exists(`alpha/${note}`)).toBe(false);
  });
  it("retains readable practice quizzes and problems after deleting their note", async () => {
    const store = await seedPractice({ root, locks });
    const before = await store.summary();
    const target = { set: "algebra", path: "notes/01-vectors.md" };
    const preview = await previewDeletion(root, locks, target);
    const result = await deleteFromTree(root, locks, target, { token: preview.token, linkedDataConfirmed: true });
    expect(await store.summary()).toEqual(before);
    expect((await store.quizView("quiz-12345678")).questions.length).toBe(5);
    expect((await store.problemsView("01-vectors.md")).problems.length).toBe(3);
    await restoreDeletion(root, locks, "algebra", result.sha);
    expect((await new PracticeStore({ root, locks }, "algebra").summary()).quizzes.length).toBe(1);
  });

  it("captures brand-new files and makes empty restored sets writable", async () => {
    const raw = Buffer.from("---\r\ntitle: Fresh\r\n---\r\nFresh bytes\r\n");
    await put("alpha/notes/fresh.md", raw);
    const fresh = await remove("notes/fresh.md");
    await restoreDeletion(root, locks, "alpha", fresh.sha);
    expect(await bytes("alpha/notes/fresh.md")).toEqual(raw);
    await put("empty/PLAN.md", "---\ntitle: Empty\n---\n");
    await fs.mkdir(path.join(root, "empty/notes"));
    const preview = await previewDeletion(root, locks, { set: "empty" });
    const deleted = await deleteFromTree(
      root,
      locks,
      { set: "empty" },
      { token: preview.token, confirmation: "Empty" },
    );
    await restoreDeletion(root, locks, "empty", deleted.sha);
    const created = await createNote(root, locks, "empty", "New note");
    expect(await exists(`empty/${created.path}`)).toBe(true);
  });

  it("deletes private legacy artifacts but keeps a poster referenced by another note", async () => {
    await put(
      `alpha/${note}`,
      (await bytes(`alpha/${note}`)).toString() +
        '\n::artifact{src="../artifacts/private.html" poster="../artifacts/shared.svg" title="Demo"}\n',
    );
    await put("alpha/artifacts/private.html", '<img src="detail.png">\n');
    await put("alpha/artifacts/detail.png", Buffer.from([1, 0, 250]));
    await put("alpha/artifacts/shared.svg", "<svg>shared poster</svg>\n");
    await put(
      "alpha/notes/01-test.md",
      `${(await bytes("alpha/notes/01-test.md")).toString()}\n![Shared poster](../artifacts/shared.svg)\n`,
    );
    const before = await bytes("alpha/artifacts/private.html");
    const result = await remove(note);
    expect(await exists("alpha/artifacts/private.html")).toBe(false);
    expect(await exists("alpha/artifacts/detail.png")).toBe(false);
    expect(await exists("alpha/artifacts/shared.svg")).toBe(true);
    await restoreDeletion(root, locks, "alpha", result.sha);
    expect(await bytes("alpha/artifacts/private.html")).toEqual(before);
  });

  it("retains already tracked gitignored files without committing their later edits", async () => {
    await git(root, ["add", "-f", "alpha/chats/private.jsonl"]);
    await git(root, ["commit", "-m", "legacy tracked chat"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@local",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@local",
    });
    await put("alpha/chats/private.jsonl", "PRIVATE LATER EDIT\n");
    const result = await remove();
    expect((await bytes("alpha/chats/private.jsonl")).toString()).toBe("PRIVATE LATER EDIT\n");
    expect(await git(root, ["show", `${result.sha}:alpha/chats/private.jsonl`])).toBe("PRIVATE CHAT\n");
    await restoreDeletion(root, locks, "alpha", result.sha);
    expect((await bytes("alpha/chats/private.jsonl")).toString()).toBe("PRIVATE LATER EDIT\n");
  });
});

describe("deletion confinement", () => {
  it("rejects reserved roots, traversal and requests for another set", async () => {
    for (const set of ["..", "library", "_global", "alpha/../beta"])
      await expect(previewDeletion(root, locks, { set })).rejects.toThrow();
    for (const p of [
      "../beta/PLAN.md",
      "notes/../../_global/profile.md",
      "beta/notes/x.md",
      "notes/../PLAN.md",
      "notes/../../library/lib-test/parsed.md",
    ])
      await expect(previewDeletion(root, locks, { set: "alpha", path: p })).rejects.toThrow();
    const result = await remove(note);
    await expect(restoreDeletion(root, locks, "beta", result.sha)).rejects.toThrow("another set");
    await expect(
      restoreDeletion(root, locks, "alpha", (await log(root, { limit: 20 })).at(-1)?.sha ?? ""),
    ).rejects.toThrow("not a learner deletion");
  });

  it("rejects external, cross-set and dangling symlinks for preview/delete/restore", async () => {
    await fs.writeFile(path.join(outside, "outside.md"), "OUTSIDE\n");
    for (const destination of [
      path.join(outside, "outside.md"),
      path.join(root, "beta/PLAN.md"),
      path.join(outside, "missing.md"),
    ]) {
      await fs.symlink(destination, path.join(root, "alpha/notes/link.md"));
      await expect(previewDeletion(root, locks, { set: "alpha", path: "notes/link.md" })).rejects.toThrow();
      await expect(previewDeletion(root, locks, { set: "alpha" })).rejects.toThrow();
      await fs.unlink(path.join(root, "alpha/notes/link.md"));
    }
    const result = await remove(note);
    await fs.rename(path.join(root, "alpha/notes"), path.join(root, "alpha/notes-old"));
    await fs.symlink(outside, path.join(root, "alpha/notes"));
    await expect(restoreDeletion(root, locks, "alpha", result.sha)).rejects.toThrow();
    expect(await fs.readFile(path.join(outside, "outside.md"), "utf8")).toBe("OUTSIDE\n");
  });

  it("rolls back all removed bytes if a filesystem mutation fails", async () => {
    const before = await bytes(`alpha/${note}`);
    const unlink = fs.unlink.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (++calls === 2) throw new Error("disk failure");
      return unlink(file);
    });
    await expect(remove(note)).rejects.toThrow("disk failure");
    expect(await bytes(`alpha/${note}`)).toEqual(before);
    expect(await exists("alpha/cards/99-different-name.md")).toBe(true);
    expect(await recentlyDeleted(root)).toEqual([]);
    expect((await git(root, ["status", "--porcelain"])).trim()).toBe("");
  });
});
