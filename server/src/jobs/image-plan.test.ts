import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as roles from "../agent/run-role.js";
import * as search from "../search/backends.js";
import * as images from "../search/images.js";
import { parseCurriculum } from "../tree/curriculum.js";
import type { DraftJobDeps } from "./draft-job.js";
import { refineChapterImages } from "./image-plan.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-image-plan-"));
  vi.spyOn(search, "configuredSearch").mockReturnValue({ search: vi.fn().mockResolvedValue({ results: [] }) } as never);
  vi.spyOn(images, "searchImages").mockResolvedValue({ candidates: [], warnings: [] });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
it("selects a captured real image with verified credit and refuses fabricated URLs", async () => {
  const chapter = parseCurriculum("- [ ] 01 — City\n  Image: Charminar monument; notice the four minarets\n")[0];
  if (!chapter) throw Error("Missing fixture chapter");
  const run = vi.spyOn(roles, "runRole").mockImplementation(async (_role, opts) => {
    const query = opts.extraTools?.find((t) => t.name === "set_image_search_query");
    if (query) {
      await query.execute("query", { query: "Charminar Hyderabad" }, undefined, undefined, {} as never);
      return { written: [], text: "Query", messages: [] };
    }
    const choose = opts.extraTools?.find((t) => t.name === "choose_chapter_image");
    if (!choose) throw Error("Missing image choice tool");
    await expect(
      choose.execute(
        "invalid",
        { url: "https://example.org/invented.jpg", reason: "The four minarets are visible." },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("provided candidate");
    await choose.execute(
      "valid",
      { url: "https://example.org/city.jpg", reason: "Street-level photograph makes four minarets visible." },
      undefined,
      undefined,
      {} as never,
    );
    return { written: [], text: "Chosen", messages: [] };
  });
  const result = await refineChapterImages(
    { root } as DraftJobDeps,
    "history",
    chapter,
    [
      {
        sourceId: "lib-city",
        url: "https://example.org/city.jpg",
        path: "library/lib-city/figures/a.jpg",
        alt: "Charminar monument",
        caption: "Charminar",
        section: "City",
        license: "CC BY-NC 4.0",
        creator: "Photographer",
        credit: "Photographer, CC BY-NC 4.0",
        sourcePage: "https://example.org/city",
      },
    ],
    "history",
    { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() },
  );
  expect(result.images[0]?.choice).toMatchObject({
    sourceId: "lib-city",
    creator: "Photographer",
    license: "CC BY-NC 4.0",
    url: "https://example.org/city.jpg",
  });
  expect(run.mock.calls[0]?.[1].canWrite?.("history/notes/a.md")).toBe(false);
  await fs.mkdir(path.join(root, "_global"));
  // D38 default allows NC; the older NC exclusion applies only with the unknown-licence allowance off.
  await fs.writeFile(
    path.join(root, "_global/config.yaml"),
    "media:\n  allowNonCommercial: false\n  allowUnknownLicense: false\n",
  );
  run.mockClear();
  const disabled = await refineChapterImages(
    { root } as DraftJobDeps,
    "history",
    chapter,
    [
      {
        sourceId: "lib-city",
        url: "https://example.org/city.jpg",
        alt: "Charminar",
        caption: "Charminar",
        section: "City",
        license: "CC BY-NC 4.0",
        credit: "Photographer",
      },
    ],
    "history",
    { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() },
  );
  expect(disabled.images[0]?.choice).toBeUndefined();
  expect(disabled.images[0]?.reason).toContain("No sufficiently relevant image");
  expect(run).toHaveBeenCalledTimes(1);
  expect(images.searchImages).toHaveBeenLastCalledWith(
    "Charminar Hyderabad",
    expect.objectContaining({ subject: "history" }),
  );
});
