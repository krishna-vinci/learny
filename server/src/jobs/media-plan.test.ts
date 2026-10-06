import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as scout from "../agent/builtins/scout-sources.js";
import * as classifiers from "../agent/classifier-workspace.js";
import * as roles from "../agent/run-role.js";
import * as search from "../search/backends.js";
import { parseCurriculum } from "../tree/curriculum.js";
import { ensureRepo } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import type { DraftJobDeps } from "./draft-job.js";
import * as ingests from "./ingest-job.js";
import { refineMediaBrief } from "./media-plan.js";

let root: string;
const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const chapter = parseCurriculum(
  "- [ ] 01 — Polymers\n  Scope: Chain structure\n  Visual: step-through widget — Polymer chains; step through growth\n  Video: Chain motion\n",
)[0];
if (!chapter) throw new Error("Missing chapter fixture");
const ctx = () => ({ signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-media-plan-"));
  await ensureRepo(root);
  await fs.mkdir(path.join(root, "science"));
  await fs.writeFile(path.join(root, "science/PLAN.md"), "---\nlevel: 2\nsubject: science\n---\n");
  vi.spyOn(classifiers, "workspaceClassifier").mockResolvedValue({} as never);
  vi.spyOn(search, "configuredSearch").mockReturnValue({} as never);
  vi.spyOn(scout, "scoutSourcesTool").mockImplementation((opts) => {
    opts.onSelected?.([
      {
        url,
        title: "Chain motion",
        type: "video",
        score: 4,
        reason: "Named university demonstration",
        quality: null,
        readable: false,
      },
    ]);
    return { name: "scout_sources" } as never;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function video(transcript: boolean) {
  await fs.mkdir(path.join(root, "library/lib-video"), { recursive: true });
  await fs.writeFile(
    path.join(root, "library/lib-video/source.md"),
    `---\nid: lib-video\ntitle: Chain motion\nauthors: [University]\ntype: video\ncredibility: verified\nparse_tier: transcript\nadded: "2026-10-05"\nurl: ${url}\n---\n`,
  );
  if (transcript)
    await fs.writeFile(
      path.join(root, "library/lib-video/parsed.md"),
      "# Polymer motion\n\n<!-- t: 30 -->\nPolymer chains move under heat.\n\n<!-- t: 90 -->\nChain motion continues.\n",
    );
}
it("chooses through M13 scouting, ingests with the transcript engine, and stores only observed moments", async () => {
  await video(true);
  const youtube = {};
  const ingest = vi
    .spyOn(ingests, "createIngestJob")
    .mockReturnValue(vi.fn().mockResolvedValue({ sourceId: "lib-video" }));
  const run = vi.spyOn(roles, "runRole").mockImplementation(async (_role, opts) => {
    const choose = opts.extraTools?.find((t) => t.name === "choose_chapter_video");
    if (!choose) throw new Error("Missing choose tool");
    await choose.execute(
      "choose",
      {
        url,
        channel: "University",
        reason: "Named university demonstration, beginner level",
        language: "English",
        levelFit: true,
        durationSeconds: 600,
      },
      undefined,
      undefined,
      {} as never,
    );
    const moment = opts.extraTools?.find((t) => t.name === "choose_video_moment");
    if (!moment) throw new Error("Missing moment tool");
    await expect(moment.execute("bad", { anchor: "t999" }, undefined, undefined, {} as never)).rejects.toThrow(
      "observed",
    );
    await moment.execute("moment", { anchor: "t30", endAnchor: "t90" }, undefined, undefined, {} as never);
    return { text: "Chosen", written: [], messages: [] };
  });
  const sources: string[] = [];
  const result = await refineMediaBrief(
    { root, locks: new FileLocks(), youtube } as DraftJobDeps,
    "science",
    chapter,
    sources,
    ctx(),
  );
  expect(result.video).toMatchObject({
    status: "chosen",
    sourceId: "lib-video",
    channel: "University",
    moment: "30–90s",
    anchor: "t30",
    watchOnly: false,
  });
  expect(sources).toEqual(["lib-video"]);
  expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ youtube }));
  await refineMediaBrief({ root, locks: new FileLocks() } as DraftJobDeps, "science", chapter, sources, ctx());
  expect(run).toHaveBeenCalledOnce();
});
it("allows quality watch-only videos with no fabricated moment and records a failed quality search honestly", async () => {
  await video(false);
  vi.spyOn(ingests, "createIngestJob").mockReturnValue(vi.fn().mockResolvedValue({ sourceId: "lib-video" }));
  const run = vi.spyOn(roles, "runRole").mockImplementation(async (_role, opts) => {
    await opts.extraTools
      ?.find((t) => t.name === "choose_chapter_video")
      ?.execute(
        "choose",
        { url, channel: "University", reason: "Institutional lab demonstration", language: "English", levelFit: true },
        undefined,
        undefined,
        {} as never,
      );
    return { text: "Chosen", written: [], messages: [] };
  });
  const sources: string[] = [];
  const result = await refineMediaBrief(
    { root, locks: new FileLocks() } as DraftJobDeps,
    "science",
    chapter,
    sources,
    ctx(),
  );
  expect(result.video).toMatchObject({ status: "chosen", watchOnly: true });
  expect(result.video.moment).toBeUndefined();
  expect(sources).toEqual([]);
  run.mockImplementation(async (_role, opts) => {
    await expect(
      opts.extraTools
        ?.find((t) => t.name === "choose_chapter_video")
        ?.execute("empty", { reason: " " }, undefined, undefined, {} as never),
    ).rejects.toThrow("concrete reason");
    await opts.extraTools
      ?.find((t) => t.name === "choose_chapter_video")
      ?.execute("none", { reason: "No named educator at the requested level" }, undefined, undefined, {} as never);
    return { text: "No suitable video", written: [], messages: [] };
  });
  const changed = { ...chapter, video: "New concept" };
  expect(
    (await refineMediaBrief({ root, locks: new FileLocks() } as DraftJobDeps, "science", changed, [], ctx())).video,
  ).toMatchObject({ status: "none", reason: "No named educator at the requested level" });
});

it("rejects refinement without an interactive plan or explicit pedagogical exception before model work", async () => {
  const run = vi.spyOn(roles, "runRole");
  await expect(
    refineMediaBrief(
      { root, locks: new FileLocks() } as DraftJobDeps,
      "science",
      { ...chapter, visuals: ["figure — Polymer chains"] },
      [],
      ctx(),
    ),
  ).rejects.toThrow("at least one interactive");
  expect(run).not.toHaveBeenCalled();
});
