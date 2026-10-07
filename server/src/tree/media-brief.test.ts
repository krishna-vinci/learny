import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseCurriculum } from "./curriculum.js";
import { ensureRepo } from "./git.js";
import { FileLocks } from "./lock.js";
import {
  chosenBriefImage,
  leanMediaBrief,
  MAX_MEDIA_BRIEF_BYTES,
  type MediaBrief,
  mediaPlanBlockers,
  noteMediaBrief,
  rankFiguresForBrief,
  rankTablesForBrief,
  readMediaBrief,
  realisedVisuals,
  saveMediaBrief,
} from "./media-brief.js";

let root: string;
const chapter = parseCurriculum(
  "- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Visual: no interactive visual: A textual source inventory has no useful manipulations.\n  Video: Geometric addition\n",
)[0];
if (!chapter) throw new Error("Missing chapter fixture");
const brief: MediaBrief = {
  chapter: "Vectors",
  scope: "",
  refinedAt: "2026-10-05",
  noInteractiveReason: "A textual source inventory has no useful manipulations.",
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
    "- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Visual: no interactive visual: A textual source inventory has no useful manipulations.\n  Video: Geometric addition\n",
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
    "- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Visual: no interactive visual: A textual source inventory has no useful manipulations.\n  Video: Geometric addition\n",
  );
  await fs.writeFile(path.join(root, "math/notes/01-old.md"), "---\ntitle: Old lesson\n---\n");
  await fs.writeFile(path.join(root, "math/notes/03-renamed.md"), "---\ntitle: New title\nchapter: vectors\n---\n");
  expect(await noteMediaBrief(root, "math/notes/01-old.md")).toBeNull();
  expect((await noteMediaBrief(root, "math/notes/03-renamed.md"))?.visuals).toEqual(brief.visuals);
});

it("blocks static substitutions for interactive concepts but accepts a real Visuals-tab attachment", async () => {
  const spec = {
    ...brief,
    noInteractiveReason: undefined,
    visuals: [
      {
        id: "visual-1",
        intent: "step-through widget — Bond lines; step through electron pairs",
        form: "step-through widget",
        concept: "Bond lines; step through electron pairs",
      },
    ],
  };
  const note = "math/notes/01-vectors.md";
  await fs.mkdir(path.join(root, "math/assets"), { recursive: true });
  await fs.mkdir(path.join(root, "math/visuals"), { recursive: true });
  await fs.writeFile(path.join(root, "math/assets/static.svg"), "<svg/>");
  await fs.writeFile(
    path.join(root, "math/visuals/steps.json"),
    JSON.stringify({
      type: "step-through",
      title: "Moves",
      steps: [
        { caption: "Start", items: [1, 2] },
        { caption: "End", items: [2, 1] },
      ],
    }),
  );
  expect(
    await mediaPlanBlockers(root, note, "<!-- media:visual-1 -->\n![Bonds](../assets/static.svg)", spec),
  ).toHaveLength(1);
  expect(
    await mediaPlanBlockers(
      root,
      note,
      '<!-- media:visual-1 -->\n::visual{src="../visuals/steps.json" title="Bond steps"}',
      spec,
    ),
  ).toEqual([]);
  expect(
    await mediaPlanBlockers(root, note, '<!-- media:visual-1 -->\n::artifact{src="../artifacts/steps.html"}', spec),
  ).toHaveLength(1);
  expect(
    await mediaPlanBlockers(
      root,
      note,
      "<!-- media:visual-1 unavailable: the source contradicts the required mechanism -->\n*The source does not support this mechanism.*",
      spec,
    ),
  ).toEqual([]);
  await fs.writeFile(path.join(root, "math/visuals/steps.json"), "{}");
  expect(
    await mediaPlanBlockers(
      root,
      note,
      '<!-- media:visual-1 -->\n::visual{src="../visuals/steps.json" title="Bond steps"}',
      spec,
    ),
  ).toHaveLength(1);
});
it("caps large legacy evidence in prompts and new files while retaining a full evidence sidecar", async () => {
  const bulky = {
    ...brief,
    tables: Array.from({ length: 8 }, () => ({
      sourceId: "lib-data",
      file: "parsed.md",
      anchor: "data",
      text: "測定 table evidence ".repeat(2000),
    })),
  };
  const lean = leanMediaBrief(bulky);
  expect(Buffer.byteLength(JSON.stringify(lean))).toBeLessThanOrEqual(MAX_MEDIA_BRIEF_BYTES);
  const saved = await saveMediaBrief(root, new FileLocks(), "math", chapter, bulky);
  const file = path.join(root, "math/media/01-vectors.md");
  expect((await fs.stat(file)).size).toBeLessThanOrEqual(MAX_MEDIA_BRIEF_BYTES);
  expect(await readMediaBrief(root, "math", chapter)).toEqual(saved);
  expect(JSON.parse(await fs.readFile(file.replace(/\.md$/, ".evidence.json"), "utf8")).tables[0].text).toBe(
    bulky.tables[0]?.text,
  );
  // Pre-M14b frontmatter is still accepted and bounded without rewriting it.
  await fs.writeFile(
    file,
    `---\n${JSON.stringify({ ...bulky, tables: [{ ...bulky.tables[0], text: "x".repeat(45000) }] })}\n---\n`,
  );
  expect(Buffer.byteLength(JSON.stringify(await readMediaBrief(root, "math", chapter)))).toBeLessThanOrEqual(
    MAX_MEDIA_BRIEF_BYTES,
  );
});

it("requires interactive specs or an explicit exception on new brief writes and refuses duplicate or nested attachments", async () => {
  await expect(
    saveMediaBrief(root, new FileLocks(), "math", chapter, { ...brief, noInteractiveReason: undefined }),
  ).rejects.toThrow("interactive");
  const spec = {
    ...brief,
    noInteractiveReason: undefined,
    visuals: [
      { id: "visual-1", intent: "step-through widget — Addition; predict the next move" },
      { id: "visual-2", intent: "step-through widget — Subtraction; predict the reverse move" },
    ],
  };
  await fs.mkdir(path.join(root, "math/visuals"), { recursive: true });
  await fs.writeFile(
    path.join(root, "math/visuals/shared.json"),
    JSON.stringify({
      type: "step-through",
      title: "Moves",
      steps: [
        { caption: "Start", items: [1, 2] },
        { caption: "End", items: [2, 1] },
      ],
    }),
  );
  const declaration = '::visual{src="../visuals/shared.json" title="Moves"}';
  const duplicate = `<!-- media:visual-1 -->\n${declaration}\n<!-- media:visual-2 -->\n${declaration}`;
  expect(await mediaPlanBlockers(root, "math/notes/01-vectors.md", duplicate, spec)).toContain(
    "Each planned interactive concept needs a distinct Visuals-tab attachment",
  );
  const nested = `:::example\n<!-- media:visual-1 -->\n${declaration}\n:::`;
  expect((await realisedVisuals(root, "math/notes/01-vectors.md", nested, spec.visuals))[0]?.made).toBe(false);
});

it("requires a real raster for image slots and keeps omission reasons visible", async () => {
  const images = { ...brief, visuals: [], images: [{ id: "image-1", intent: "Charminar street setting" }] };
  const note = "history/notes/01-city.md";
  await fs.mkdir(path.join(root, "history/assets"), { recursive: true });
  await fs.writeFile(path.join(root, "history/assets/photo.jpg"), "raster fixture");
  expect(
    await mediaPlanBlockers(
      root,
      note,
      '<!-- media:image-1 -->\n![City](../assets/photo.jpg "Credit: Photographer, CC BY 4.0, https://example.org/city")',
      images,
    ),
  ).toEqual([]);
  expect(
    await mediaPlanBlockers(root, note, "```md\n<!-- media:image-1 -->\n![City](../assets/photo.jpg)\n```", images),
  ).toHaveLength(1);
  expect(
    await mediaPlanBlockers(root, note, "<!-- media:image-1 -->\n![City](../assets/photo.svg)", images),
  ).toHaveLength(1);
  expect(
    await mediaPlanBlockers(
      root,
      note,
      "<!-- media:image-1 unavailable: No suitable licensed photograph exists. -->\n*No suitable licensed photograph was found.*",
      images,
    ),
  ).toEqual([]);
  expect(
    await mediaPlanBlockers(
      root,
      note,
      "<!-- media:image-1 unavailable: No suitable licensed photograph exists. -->",
      images,
    ),
  ).toHaveLength(1);
});

it("compacts three image choices under 5 KB while saving their complete attribution separately", async () => {
  const creator = "Named contributor ".repeat(90);
  const full: MediaBrief = {
    ...brief,
    images: Array.from({ length: 3 }, (_, i) => ({
      id: `image-${i + 1}`,
      intent: "Real material appearance",
      choice: {
        url: `https://example.org/image-${i}.jpg`,
        thumbnail: `https://example.org/thumb-${i}.jpg`,
        title: "Material",
        creator,
        license: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourcePage: `https://example.org/material-${i}`,
      },
    })),
  };
  const lean = await saveMediaBrief(root, new FileLocks(), "science", chapter, full);
  expect(Buffer.byteLength(JSON.stringify(lean))).toBeLessThanOrEqual(MAX_MEDIA_BRIEF_BYTES);
  expect(lean.images?.[0]?.choice?.creator.length).toBeLessThan(creator.length);
  expect(await chosenBriefImage(root, "science", "https://example.org/image-0.jpg")).toMatchObject({
    creator,
    sourcePage: "https://example.org/material-0",
    thumbnail: "https://example.org/thumb-0.jpg",
  });
});

it("ranks chapter scope and visual intents above capture order for figures and tables", () => {
  const chapter = {
    title: "Carbon structures and reactive groups",
    scope:
      "Read displayed, condensed and simple line structures; recognize alkene, alcohol, carboxylic acid, amine, ester and amide groups.",
    visuals: [
      "chart — The same molecule in three drawing conventions",
      "figure — Highlighted functional groups in polymer-related molecules",
    ],
  };
  const figure = (caption: string, section: string, path?: string) => ({
    caption,
    alt: "",
    section,
    ...(path ? { path } : {}),
  });
  const ranked = rankFiguresForBrief(
    [
      figure("Thermal transitions in amorphous and semicrystalline polymers", "Thermal behaviour", "library/a/1.png"),
      figure("DNA double helix structure", "Nucleic acids", "library/a/2.png"),
      figure(
        "Functional groups: alcohol, carboxylic acid, amine, ester and amide",
        "Drawing line structures",
        "library/a/3.png",
      ),
    ],
    chapter,
  );
  expect(ranked[0]?.caption).toContain("Functional groups");
  expect(ranked.at(-1)?.caption).toContain("DNA");
  const tables = rankTablesForBrief(
    [
      { sourceId: "a", file: "f", anchor: "t1", text: "| Tg | melting |" },
      { sourceId: "a", file: "f", anchor: "t2", text: "| carboxylic acid | amine | ester | amide |" },
    ],
    chapter,
  );
  expect(tables[0]?.text).toContain("carboxylic acid");
});

it("keeps distinct chapter concepts within the brief budget instead of redundant figures", () => {
  const candidate: MediaBrief = {
    ...brief,
    chapter: "Carbon structures and reactive groups",
    scope: "Condensed line structures and functional groups",
    visuals: [
      { id: "visual-1", intent: "chart — Condensed line structures" },
      { id: "visual-2", intent: "figure — Functional groups" },
    ],
    figures: Array.from({ length: 12 }, (_, index) => ({
      sourceId: "drawing",
      url: `https://example.org/${index}/${"x".repeat(250)}`,
      alt: "Condensed line structures",
      caption: "Condensed line structures",
      section: "Condensed line structures",
      credit: "Author, Licence unknown, https://example.org/drawing",
    })),
    tables: [{ sourceId: "groups", file: "parsed.md", anchor: "groups", text: "| Functional groups |" }],
  };
  const lean = leanMediaBrief(candidate);
  expect(lean.figures.length).toBeGreaterThan(0);
  expect(lean.tables.map((table) => table.anchor)).toContain("groups");
  expect(Buffer.byteLength(JSON.stringify(lean))).toBeLessThanOrEqual(MAX_MEDIA_BRIEF_BYTES);
});

it("does not reuse a note media brief after a video-only edit", async () => {
  await fs.mkdir(path.join(root, "math/notes"), { recursive: true });
  await fs.writeFile(path.join(root, "math/notes/01-vectors.md"), "---\ntitle: Vectors\nchapter: vectors\n---\n");
  await saveMediaBrief(root, new FileLocks(), "math", chapter, brief);
  await fs.writeFile(
    path.join(root, "math/curriculum.md"),
    "- [ ] 01 — Vectors\n  Visual: figure — Addition\n  Visual: no interactive visual: A textual source inventory has no useful manipulations.\n  Video: New demonstration\n",
  );
  expect((await noteMediaBrief(root, "math/notes/01-vectors.md"))?.video).toMatchObject({
    intent: "New demonstration",
    status: "none",
    reason: "Media sources have not been refined yet.",
  });
});
