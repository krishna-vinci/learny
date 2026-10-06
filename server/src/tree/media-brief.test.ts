import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseCurriculum } from "./curriculum.js";
import { ensureRepo } from "./git.js";
import { FileLocks } from "./lock.js";
import {
  type MediaBrief,
  mediaPlanBlockers,
  noteMediaBrief,
  readMediaBrief,
  realisedVisuals,
  saveMediaBrief,
} from "./media-brief.js";

let root: string;
const chapter = parseCurriculum("- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Video: Geometric addition\n")[0];
if (!chapter) throw new Error("Missing chapter fixture");
const brief: MediaBrief = {
  chapter: "Vectors",
  scope: "",
  refinedAt: "2026-10-05",
  visuals: [{ id: "visual-1", intent: "figure — Addition" }],
  figures: [],
  tables: [],
  video: { intent: "Geometric addition", status: "none", reason: "No named educator found" },
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-media-brief-"));
  await ensureRepo(root);
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
it("persists a plain-file brief under a confined per-chapter path", async () => {
  await saveMediaBrief(root, new FileLocks(), "math", chapter, brief);
  expect(await readMediaBrief(root, "math", chapter)).toEqual(brief);
  await fs.rename(path.join(root, "math/media"), path.join(root, "other"));
  await fs.symlink(path.join(root, "other"), path.join(root, "math/media"));
  await expect(saveMediaBrief(root, new FileLocks(), "math", chapter, brief)).rejects.toThrow("symlink aliases");
});
it("blocks silent omissions, ignores fenced examples and recognises actual files and explicit explanations", async () => {
  const notePath = "math/notes/01-vectors.md";
  expect(
    await mediaPlanBlockers(root, notePath, "```md\n<!-- media:visual-1 -->\n![Addition](../assets/x.svg)\n```", brief),
  ).toHaveLength(1);
  expect(
    await mediaPlanBlockers(root, notePath, "<!-- media:visual-1 -->\n![Addition](../assets/x.svg)", brief),
  ).toHaveLength(1);
  await fs.mkdir(path.join(root, "math/assets"), { recursive: true });
  await fs.writeFile(path.join(root, "math/assets/x.svg"), "<svg/>");
  expect(
    await realisedVisuals(root, notePath, "<!-- media:visual-1 -->\n![Addition](../assets/x.svg)", brief.visuals),
  ).toEqual([{ intent: "figure — Addition", made: true, path: "../assets/x.svg" }]);
  expect(
    await mediaPlanBlockers(
      root,
      notePath,
      "<!-- media:visual-1 unavailable: no data to plot -->\n*No trustworthy plot data was available.*",
      brief,
    ),
  ).toEqual([]);
  expect(
    await realisedVisuals(
      root,
      notePath,
      "<!-- media:visual-1 unavailable: no data to plot -->\n*No trustworthy plot data was available.*",
      brief.visuals,
    ),
  ).toEqual([{ intent: "figure — Addition", made: false, reason: "No trustworthy plot data was available." }]);
});
it("retains curriculum visual requirements when the saved brief is missing or stale", async () => {
  await fs.mkdir(path.join(root, "math"));
  await fs.writeFile(
    path.join(root, "math/curriculum.md"),
    "- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Video: Geometric addition\n",
  );
  const notePath = "math/notes/01-vectors.md";
  expect(await mediaPlanBlockers(root, notePath, "# Vectors", await noteMediaBrief(root, notePath))).toHaveLength(1);
  await saveMediaBrief(root, new FileLocks(), "math", chapter, { ...brief, visuals: [] });
  expect((await noteMediaBrief(root, notePath))?.visuals).toEqual(brief.visuals);
});

it("ignores old notes with reused numbers and loads media for a renamed note with a chapter id", async () => {
  await fs.mkdir(path.join(root, "math/notes"), { recursive: true });
  await fs.writeFile(
    path.join(root, "math/curriculum.md"),
    "- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Video: Geometric addition\n",
  );
  await fs.writeFile(path.join(root, "math/notes/01-old.md"), "---\ntitle: Old lesson\n---\n");
  await fs.writeFile(path.join(root, "math/notes/03-renamed.md"), "---\ntitle: New title\nchapter: vectors\n---\n");
  expect(await noteMediaBrief(root, "math/notes/01-old.md")).toBeNull();
  expect((await noteMediaBrief(root, "math/notes/03-renamed.md"))?.visuals).toEqual(brief.visuals);
});
