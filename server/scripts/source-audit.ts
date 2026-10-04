import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { listSources, readSource } from "../src/ingest/library.js";
import { scoreParseQuality } from "../src/ingest/quality.js";

// Read-only: pass a temp tree explicitly, never a default pointing at production.
const root = process.argv[2];
if (!root) throw new Error("Usage: tsx scripts/source-audit.ts <temporary-study-tree> [output.md]");
const rows = [];
for (const source of await listSources(root)) {
  const view = await readSource(root, source.id);
  if (!view) continue;
  const content = (
    await Promise.all(
      view.parsedFiles.map(async (rel) => {
        const text = await fs.readFile(path.join(root, "library", source.id, rel), "utf8");
        return parseFrontmatter(text).body;
      }),
    )
  ).join("\n\n");
  const quality = scoreParseQuality(content);
  rows.push({ id: source.id, title: source.title, url: source.url, quality });
}
rows.sort((a, b) => a.quality.score - b.quality.score || a.id.localeCompare(b.id));
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
const output = [
  "# M12 source audit",
  "",
  "Parse health only; not a measure of factual authority. Read-only audit of a temporary workspace copy.",
  "",
  "| Source | Score | Characters | Headings | Math damage | Broken chars | Boilerplate ratio | Truncated |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...rows.map(
    ({ id, quality: q }) =>
      `| ${cell(id)} | ${q.score} | ${q.signals.characters} | ${q.signals.headings} | ${q.signals.garbledMath} | ${q.signals.brokenCharacters} | ${(1 - q.signals.mainTextRatio).toFixed(2)} | ${q.signals.truncation} |`,
  ),
  "",
].join("\n");
if (process.argv[3]) await fs.writeFile(process.argv[3], output);
else process.stdout.write(output);
