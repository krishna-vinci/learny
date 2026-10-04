import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { reviewVideoEvidence } from "./video-evidence.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-video-evidence-"));
  await fs.mkdir(path.join(root, "set"), { recursive: true });
  await fs.mkdir(path.join(root, "library/lib-demo"), { recursive: true });
  await fs.writeFile(path.join(root, "set/PLAN.md"), "---\ntitle: Demos\nsources: [lib-demo]\n---\n");
  await fs.writeFile(
    path.join(root, "library/lib-demo/source.md"),
    "---\nid: lib-demo\ntitle: Motion demo\nauthors: [Teacher]\ntype: video\nurl: https://www.youtube.com/watch?v=dQw4w9WgXcQ\ncredibility: B\nparse_tier: transcript\nadded: 2026-10-04\n---\n",
  );
  await fs.writeFile(
    path.join(root, "library/lib-demo/parsed.md"),
    "<!-- t:40 -->\nA rotating vector transforms spatial coordinates.\n<!-- t:60 -->\nA matrix transformation changes a rotating vector.\n<!-- t:100 -->\nAnother example.",
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const note = (paragraph: string, start = 40, end = 90) =>
  `# Motion\n\n## Spatial transformation\n\n${paragraph}\n\n::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=${start} end=${end}}\n`;
it("accepts a real adjacent transcript moment and flags mismatched prose for semantic checking", async () => {
  expect(
    (
      await reviewVideoEvidence(
        root,
        "set",
        note("A rotating vector transforms spatial coordinates.[^src:lib-demo#t40]"),
      )
    ).blockers,
  ).toEqual([]);
  expect(
    (await reviewVideoEvidence(root, "set", note("Chocolate biscuits taste delicious.[^src:lib-demo#t40]"))).hints.join(
      " ",
    ),
  ).toContain("does not lexically match");
});
it("blocks unsupported timestamps, top decoration and transcript-free claim citations", async () => {
  const moment = note("A rotating vector.[^src:lib-demo#t40]");
  expect(
    (
      await reviewVideoEvidence(
        root,
        "set",
        `${moment}\nA rotating vector.[^src:lib-demo#t40]\n\n::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=40 end=90}\n`,
      )
    ).blockers,
  ).toContain("Use at most one video moment per concept.");
  expect(
    (await reviewVideoEvidence(root, "set", note("A vector.[^src:lib-demo#t40]", 70, 300))).blockers.join(" "),
  ).toContain("180 seconds");
  expect(
    (await reviewVideoEvidence(root, "set", note("A vector.[^src:lib-demo#t40]", 70, 90))).blockers.join(" "),
  ).toContain("after the cited transcript section");
  expect(
    (
      await reviewVideoEvidence(root, "set", `::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=40 end=90}\n`)
    ).blockers.join(" "),
  ).toContain("supporting paragraph");
  await fs.unlink(path.join(root, "library/lib-demo/parsed.md"));
  expect((await reviewVideoEvidence(root, "set", "Watch it.[^src:lib-demo#t40]")).blockers.join(" ")).toContain(
    "cannot support claims",
  );
});
it("hints at an unused suitable demonstration but ignores fenced example directives", async () => {
  const result = await reviewVideoEvidence(
    root,
    "set",
    "## Spatial transformation demo\n\nA rotating vector transforms spatial coordinates.\n\n```md\n::youtube{src=invalid}\n```",
  );
  expect(result.blockers).toEqual([]);
  expect(result.hints.join(" ")).toContain("is unused");
});
