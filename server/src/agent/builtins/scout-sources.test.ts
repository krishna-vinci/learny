import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { domainPreferences, recordDomainOutcome } from "../../ingest/domain-outcomes.js";
import { scoutSourcesTool } from "./scout-sources.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it("dedupes AMP/tracking, rejects basic-level papers/images and drops thin parses", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-scout-"));
  roots.push(root);
  const fetchMock = vi.fn(
    async (url: unknown) =>
      new Response(
        `<html><body><article><h1>Source</h1><p>${String(url).includes("thin") ? "Tiny" : "An expert explains polymers with useful examples. ".repeat(40)}</p></article></body></html>`,
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const candidate = (url: string, type = "explainer") => ({
    url,
    title: "Polymers",
    reason: "Expert explains chains",
    score: 4,
    type,
  });
  const tool = scoutSourcesTool({ root });
  const result = await tool.execute(
    "1",
    {
      brief: "Polymers",
      level: 2,
      researchNeeded: false,
      candidates: [
        candidate("https://93.184.216.34/course?utm_source=x"),
        candidate("https://93.184.216.34/course/amp"),
        candidate("https://93.184.216.34/thin"),
        candidate("https://93.184.216.34/paper", "paper"),
        candidate("https://93.184.216.34/a.png"),
      ],
    },
    undefined,
    undefined,
    undefined as never,
  );
  expect(result.details).toMatchObject({ isError: false });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining("&quot;quality&quot;:100") });
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Thin/damaged") });
});
it("learns bounded domain outcomes without following cache symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-domains-"));
  roots.push(root);
  await recordDomainOutcome(root, "https://expert.example/page?token=secret", "cited-checked");
  await recordDomainOutcome(root, "https://blocked.example", "blocked");
  expect((await domainPreferences(root)).get("expert.example")).toBe(0.2);
  expect((await domainPreferences(root)).get("blocked.example")).toBe(-0.3);
  expect(await fs.readFile(path.join(root, ".cache/source-domains.jsonl"), "utf8")).not.toContain("secret");
});
