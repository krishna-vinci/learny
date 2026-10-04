/** Complete the live comparison with fresh parse scores and a transcript-ladder attempt. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parsePlanProposal } from "../src/inbox/plans.js";
import { detectInput } from "../src/ingest/detect.js";
import { publicErrorReason } from "../src/ingest/error-reason.js";
import { scoreParseQuality } from "../src/ingest/quality.js";
import { extract } from "../src/ingest/types.js";

const evalRoot = process.argv[2];
if (!evalRoot?.startsWith("/tmp/studium-m12-scout-")) throw new Error("Pass scouting temp directory");
const out = path.resolve("../docs/plans/2026-10-04-m12-source-proposed-scores.md");
const rows: string[] = [];
const narratives: string[] = [];
const save = () =>
  fs.writeFile(
    out,
    [
      "# M12 proposed-source parse scores",
      "",
      "Fresh fetches of the three real Outliner proposals; no source registration or production writes. Parse health does not imply authority. Unknown video transcripts/captions remain unknown.",
      "",
      "| Subject | Proposed URL | Score | Outcome |",
      "| --- | --- | ---: | --- |",
      ...rows,
      "",
      ...narratives,
      "",
    ].join("\n"),
  );
await save();
for (const set of ["polymers", "hyderabad-history", "linear-algebra"]) {
  const dir = path.join(evalRoot, set, set, "plan-proposals");
  const file = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .at(-1);
  if (!file) continue;
  const proposalText = await fs.readFile(path.join(dir, file), "utf8");
  const proposal = parsePlanProposal(proposalText);
  narratives.push(`## ${set}`, "", proposalText.slice(proposalText.indexOf("## Sources to add")), "");
  for (const url of proposal.sourcesToAdd) {
    let score: string = "unknown",
      outcome: string = "";
    try {
      const item = await extract(
        detectInput({ url }),
        { url },
        {
          firecrawlUrl: process.env.FIRECRAWL_API_URL,
          firecrawlKey: process.env.FIRECRAWL_API_KEY,
          signal: AbortSignal.timeout(75000),
        },
      );
      score = item.unreadable ? "0 (watch-only)" : String(scoreParseQuality(item.markdown).score);
      outcome = item.unreadable
        ? (item.warning ?? "No transcript")
        : `${item.markdown.length} characters; ${item.parseTier}`;
    } catch (error) {
      outcome = publicErrorReason(error);
    }
    rows.push(`| ${set} | ${url} | ${score} | ${outcome.replace(/\|/g, "\\|")} |`);
    await save();
    console.log(`${set}: ${score}`);
  }
}
