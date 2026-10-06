import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as scoutTools from "../agent/builtins/scout-sources.js";
import * as classifier from "../agent/classifier-workspace.js";
import * as roleRunner from "../agent/run-role.js";
import { coverageKey, loadCoverage } from "../search/coverage.js";
import type { DraftJobDeps } from "./draft-job.js";
import * as ingestJobs from "./ingest-job.js";
import { sourcePreflight } from "./source-preflight.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it("passes the configured transcript engine to inline candidate ingestion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-preflight-"));
  roots.push(root);
  vi.spyOn(classifier, "workspaceClassifier").mockResolvedValue({} as never);
  vi.spyOn(roleRunner, "runRole").mockResolvedValue({ text: "Selected", messages: [], written: [] });
  vi.spyOn(scoutTools, "scoutSourcesTool").mockImplementation((opts) => {
    opts.onSelected?.([
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Demo",
        reason: "A worked demo",
        score: 4,
        type: "video",
        images: [{ url: "https://example.org/figure.png", alt: "", nearHeading: "" }],
        quality: null,
        readable: false,
      },
    ]);
    return {} as never;
  });
  const ingest = vi.spyOn(ingestJobs, "createIngestJob").mockReturnValue(vi.fn().mockResolvedValue(undefined));
  const youtube = {} as NonNullable<DraftJobDeps["youtube"]>;
  await sourcePreflight(
    { root, youtube } as DraftJobDeps,
    { set: "set", title: "Motion", brief: "Spatial manipulation" },
    "",
    "",
    [],
    { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() },
  );
  expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ youtube, candidateImages: expect.any(Map) }));
  expect(ingest.mock.calls[0]?.[0].candidateImages?.get("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual([
    { url: "https://example.org/figure.png", alt: "", nearHeading: "" },
  ]);
});
it("scouts gaps before drafting, forbids writes and stores residual coverage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-preflight-"));
  roots.push(root);
  vi.spyOn(classifier, "workspaceClassifier").mockResolvedValue({} as never);
  const run = vi
    .spyOn(roleRunner, "runRole")
    .mockResolvedValue({ text: "No suitable source found.", messages: [], written: [] });
  const deps = { root } as DraftJobDeps;
  const ctx = { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() };
  const result = await sourcePreflight(
    deps,
    { set: "set", title: "Polymers" },
    "---\nlevel: 2\n---\n",
    "- [ ] 01 — Polymers\n  Scope: Cross-linking and glass transition.\n  Prerequisites: none\n",
    [],
    ctx,
  );
  expect(result.coverage).toMatchObject({ covered: 0, total: 2 });
  expect(run).toHaveBeenCalledWith(
    "outliner",
    expect.objectContaining({ extraTools: expect.any(Array), task: expect.stringContaining("Cross-linking") }),
  );
  expect(run.mock.calls[0]?.[1].canWrite?.("set/notes/01.md")).toBe(false);
  expect(
    (await loadCoverage(root)).get(coverageKey("set", "Polymers", "Cross-linking and glass transition.")),
  ).toMatchObject({ covered: 0, total: 2 });
});

it("uses the matching title scope rather than a same-number old chapter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-preflight-"));
  roots.push(root);
  vi.spyOn(classifier, "workspaceClassifier").mockResolvedValue({} as never);
  const run = vi
    .spyOn(roleRunner, "runRole")
    .mockResolvedValue({ text: "No suitable source found.", messages: [], written: [] });
  const result = await sourcePreflight(
    { root } as DraftJobDeps,
    { set: "polymers", title: "Bonds and simple molecular drawings" },
    "",
    "- [ ] 01 — Old polymers\n  Scope: Old concept\n- [ ] 02 — Bonds and simple molecular drawings\n  Scope: Covalent bonds and Lewis structures.\n",
    [],
    { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() },
  );
  expect(result.coverage).toMatchObject({ total: 2, weakest: ["Covalent bonds", "Lewis structures"] });
  expect(run.mock.calls[0]?.[1].task).toContain("Covalent bonds");
  expect(run.mock.calls[0]?.[1].task).not.toContain("Old concept");
});
