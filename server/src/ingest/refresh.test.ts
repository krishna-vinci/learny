import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sourcePassages } from "../search/passages.js";
import { ensureRepo, log } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { FileLocks } from "../tree/lock.js";
import { readSource, writeSource } from "./library.js";
import { refreshSource } from "./refresh.js";
import { preserveSectionAnchors, sourceSections } from "./sections.js";
import { type Extracted, extract } from "./types.js";

vi.mock("./types.js", () => ({ extract: vi.fn() }));
let root: string;
const prose = "A useful teaching explanation with examples and evidence. ".repeat(25);
const extracted = (markdown = `# Existing\n\n${prose}\n\n## Removed\n\nAn old section.`): Extracted => ({
  title: "Lesson",
  authors: ["Teacher"],
  url: "https://example.org/lesson",
  markdown,
  pages: null,
  parseTier: "basic",
  warning: null,
  originalExt: null,
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-refresh-"));
  await initStudyTree(root);
  await ensureRepo(root);
  vi.mocked(extract).mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
it("refreshes in place, preserves renamed matching anchors, reports removed sections and commits as librarian", async () => {
  const { id } = await writeSource(root, extracted());
  const snapshot = parseFrontmatter(await fs.readFile(path.join(root, `library/${id}/source.md`), "utf8"));
  vi.mocked(extract).mockResolvedValue(extracted(`# Renamed\n\n${prose}\n\n## New\n\nA new example.`));
  const result = await refreshSource({ root, locks: new FileLocks() }, id);
  expect(result.refresh).toMatchObject({ sourceId: id, status: "refreshed", disappearedAnchors: ["removed"] });
  expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
  const next = parseFrontmatter(await fs.readFile(path.join(root, `library/${id}/source.md`), "utf8"));
  expect(next.frontmatter).toMatchObject({
    id,
    url: snapshot.frontmatter.url,
    credibility: snapshot.frontmatter.credibility,
  });
  expect((await sourcePassages(root, [id])).map((p) => p.anchor)).toContain("existing");
  expect((await readSource(root, id))?.source.lastRefresh?.after).toBe(result.refresh.after);
  expect((await log(root, { limit: 1 }))[0]?.subject).toBe(`librarian: refresh ${id}`);
});
it("retains the old parse on blocked and lower-quality fetches, remembers blocked hosts", async () => {
  const { id } = await writeSource(root, extracted());
  const old = await fs.readFile(path.join(root, `library/${id}/parsed.md`), "utf8");
  const blockedHosts = new Map<string, string>();
  vi.mocked(extract).mockRejectedValueOnce(new Error("HTTP 403 blocked"));
  const options = { root, locks: new FileLocks(), blockedHosts };
  expect((await refreshSource(options, id)).refresh).toMatchObject({
    status: "skipped",
    reason: expect.stringContaining("403"),
  });
  expect((await refreshSource(options, id)).refresh.reason).toContain("Host skipped");
  expect(extract).toHaveBeenCalledTimes(1);
  vi.mocked(extract).mockResolvedValue(extracted("tiny"));
  expect((await refreshSource({ ...options, blockedHosts: new Map() }, id)).refresh.status).toBe("unchanged");
  expect(await fs.readFile(path.join(root, `library/${id}/parsed.md`), "utf8")).toBe(old);
});
it("requires the uploaded original even when metadata has a URL and reads present originals locally", async () => {
  const { id } = await writeSource(root, extracted(), { bytes: new TextEncoder().encode(prose), ext: "txt" });
  const original = path.join(root, `library/${id}/original.txt`);
  await fs.unlink(original);
  expect((await refreshSource({ root, locks: new FileLocks() }, id)).refresh.reason).toContain("original is missing");
  expect(extract).not.toHaveBeenCalled();
  await fs.writeFile(original, prose);
  vi.mocked(extract).mockResolvedValue(extracted());
  expect((await refreshSource({ root, locks: new FileLocks() }, id)).refresh.status).toBe("refreshed");
  expect(vi.mocked(extract).mock.calls[0]?.[1]).toMatchObject({
    filename: "original.txt",
    bytes: expect.any(Uint8Array),
  });
  expect(vi.mocked(extract).mock.calls[0]?.[1].url).toBeUndefined();
});
it("rejects symlink aliases before writing and preserves concurrent source edits", async () => {
  const { id } = await writeSource(root, extracted());
  const file = path.join(root, `library/${id}/parsed.md`);
  await fs.rename(file, path.join(root, "other.md"));
  await fs.symlink(path.join(root, "other.md"), file);
  await expect(refreshSource({ root, locks: new FileLocks() }, id)).rejects.toThrow("symlink aliases");
  expect(extract).not.toHaveBeenCalled();
  await fs.unlink(file);
  await fs.rename(path.join(root, "other.md"), file);
  vi.mocked(extract).mockImplementation(async () => {
    await fs.appendFile(path.join(root, `library/${id}/source.md`), "\nLearner edit\n");
    return extracted();
  });
  expect((await refreshSource({ root, locks: new FileLocks() }, id)).refresh.reason).toContain(
    "changed during refresh",
  );
  expect(await fs.readFile(path.join(root, `library/${id}/source.md`), "utf8")).toContain("Learner edit");
});
it("keeps duplicate-section locators when reordered and ignores anchor-like code", () => {
  const old = "# Same\n\nFirst paragraph.\n\n# Same\n\nSecond paragraph.";
  const next = "# Same\n\nSecond paragraph.\n\n# Same\n\nFirst paragraph.";
  const kept = preserveSectionAnchors(old, next);
  expect(kept.disappeared).toEqual([]);
  expect(sourceSections(kept.markdown).map((s) => [s.anchor, s.summary])).toEqual([
    ["same-1", "Second paragraph."],
    ["same", "First paragraph."],
  ]);
  expect(sourceSections("# Real\n\n```\n<!-- anchor: fake -->\n```\n")[0]?.anchor).toBe("real");
});

it("refreshes saved PDFs through the PDF extractor even with an arXiv source URL and stages their figures", async () => {
  const original = new TextEncoder().encode("%PDF fake");
  const { id } = await writeSource(root, extracted(), { bytes: original, ext: "pdf" });
  const sourceFile = path.join(root, `library/${id}/source.md`);
  const snapshot = await fs.readFile(sourceFile, "utf8");
  // Model a URL-ingested PDF: original present but no upload hash.
  await fs.writeFile(
    sourceFile,
    snapshot.replace(/^sha256: .*\n/m, "").replace("https://example.org/lesson", "https://arxiv.org/abs/2601.07372"),
  );
  const file = `figures/${"a".repeat(24)}.png`;
  const bytes = new Uint8Array([1, 2, 3]);
  vi.mocked(extract).mockResolvedValue({
    ...extracted(),
    markdown: `# Existing\n\n${prose}\n\n![Figure](${file})`,
    parseTier: "mineru",
    embeddedFigures: {
      files: new Map([[file, bytes]]),
      figures: [
        {
          path: file,
          url: "https://arxiv.org/abs/2601.07372#figure-test",
          caption: "Figure 1",
          alt: "Figure",
          section: "Existing",
          credit: "Cheng, source (licence unknown)",
          sourcePage: "https://arxiv.org/abs/2601.07372",
        },
      ],
    },
  });
  const result = await refreshSource({ root, locks: new FileLocks(), mineruUrl: "http://127.0.0.1:18750" }, id);
  expect(result.refresh.status).toBe("refreshed");
  expect(vi.mocked(extract).mock.calls[0]).toMatchObject([
    "pdf",
    { filename: "original.pdf", url: "https://arxiv.org/abs/2601.07372", bytes: original },
    { mineruUrl: "http://127.0.0.1:18750" },
  ]);
  expect(await fs.readFile(path.join(root, `library/${id}/${file}`))).toEqual(Buffer.from(bytes));
  expect(JSON.parse(await fs.readFile(path.join(root, `library/${id}/images.json`), "utf8"))[0].caption).toBe(
    "Figure 1",
  );
});
