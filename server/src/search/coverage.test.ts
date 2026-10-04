import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { chapterConcepts, coverageKey, loadCoverage, measureCoverage, saveCoverage } from "./coverage.js";

it("finds section-supported scope concepts and reports weakest concepts", () => {
  const concepts = chapterConcepts("Polymers", "Chain growth, cross-linking and glass transition.");
  expect(concepts).toEqual(["Chain growth", "cross-linking", "glass transition"]);
  const coverage = measureCoverage(concepts, [
    {
      id: "a",
      source: "lib-a",
      file: "parsed.md",
      anchor: "start",
      text: "Chain growth proceeds by addition. Glass transition controls material properties.",
      score: 0,
      cited: false,
    },
  ]);
  expect(coverage).toMatchObject({ covered: 2, total: 3, weakest: ["cross-linking"] });
});
it("persists optional coverage and refuses cache symlink escape", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-coverage-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-cache-"));
  try {
    const coverage = measureCoverage(["missing"], []);
    await saveCoverage(root, "set", "Title", "missing", coverage);
    expect((await loadCoverage(root)).get(coverageKey("set", "Title", "missing"))).toMatchObject({
      covered: 0,
      total: 1,
    });
    await fs.rm(path.join(root, ".cache"), { recursive: true });
    await fs.symlink(outside, path.join(root, ".cache"));
    await saveCoverage(root, "set", "Title", "missing", coverage);
    expect(await fs.readdir(outside)).toEqual([]);
    expect((await loadCoverage(root)).size).toBe(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
