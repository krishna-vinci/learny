import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { stringify } from "yaml";
import { detectInput } from "../src/ingest/detect.js";
import { publicErrorReason } from "../src/ingest/error-reason.js";
import { listSources, readParsedFile, readSource } from "../src/ingest/library.js";
import { scoreParseQuality } from "../src/ingest/quality.js";
import { sourceSections } from "../src/ingest/sections.js";
import { splitParsed } from "../src/ingest/split.js";
import { extract } from "../src/ingest/types.js";

const root = process.argv[2];
if (!root?.startsWith("/tmp/studium-m12-")) throw new Error("Pass an M12 temporary copy under /tmp/studium-m12-*");
const out = process.argv[3];
if (!out) throw new Error("Pass a report path");
const sources = [];
for (const s of await listSources(root)) {
  const view = await readSource(root, s.id);
  const markdown = (
    await Promise.all((view?.parsedFiles ?? []).map(async (f) => (await readParsedFile(root, s.id, f)) ?? ""))
  ).join("\n\n");
  sources.push({ ...s, before: scoreParseQuality(markdown).score });
}
sources.sort((a, b) => a.before - b.before || a.id.localeCompare(b.id));
const rows: string[] = [];
const save = () =>
  fs.writeFile(
    out,
    [
      "# M12 re-import of the ten worst parses",
      "",
      "Temporary copy only. Retain the better result; failures preserve the old parse. No LLM calls.",
      "",
      "| Source | Before | After | Result |",
      "| --- | ---: | ---: | --- |",
      ...rows,
      "",
    ].join("\n"),
  );
for (const source of sources.slice(0, 10)) {
  let after = source.before;
  let result = "No URL; cannot re-import";
  try {
    if (source.url) {
      const input = { url: source.url };
      const extracted = await extract(detectInput(input), input, {
        firecrawlUrl: process.env.FIRECRAWL_API_URL,
        firecrawlKey: process.env.FIRECRAWL_API_KEY,
        signal: AbortSignal.timeout(75000),
      });
      const quality = scoreParseQuality(extracted.markdown);
      after = Math.max(source.before, quality.score);
      result = quality.score > source.before ? "Improved" : "Retained old parse (no improvement)";
      if (quality.score > source.before) {
        const dir = path.join(root, "library", source.id);
        // This is the isolated script's own copy; no live files or originals are touched.
        const view = await readSource(root, source.id);
        for (const file of view?.parsedFiles ?? []) await fs.unlink(path.join(dir, file));
        const split = splitParsed(extracted.markdown);
        for (const part of split.parts) {
          const file = path.join(dir, part.path);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, part.content);
        }
        const old = parseFrontmatter(await fs.readFile(path.join(dir, "source.md"), "utf8"));
        await fs.writeFile(
          path.join(dir, "source.md"),
          `---\n${stringify({ ...old.frontmatter, quality })}---\n${old.body}`,
        );
        await fs.writeFile(
          path.join(dir, "sections.json"),
          JSON.stringify(
            sourceSections(extracted.markdown).map(({ anchor, summary }) => ({ anchor, summary })),
            null,
            2,
          ),
        );
        if (extracted.images)
          await fs.writeFile(path.join(dir, "images.json"), JSON.stringify(extracted.images, null, 2));
      }
    }
  } catch (error) {
    result = publicErrorReason(error).replace(/\|/g, "\\|");
  }
  rows.push(`| ${source.id} | ${source.before} | ${after} | ${result} |`);
  await save();
  console.log(`${source.id}: ${source.before} → ${after}`);
}
