import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type ClassifierLogRow, summarizeClassifier } from "../src/agent/classifier-report.js";

let files = process.argv[2] ? [process.argv[2]] : [];
if (!files.length) {
  const users = path.resolve(process.env.STUDIUM_DATA_DIR ?? "../data", "users");
  const entries = await readdir(users, { withFileTypes: true }).catch(() => []);
  files = entries.filter((e) => e.isDirectory()).map((e) => path.join(users, e.name, ".cache/classifier-log.jsonl"));
  if (process.env.STUDIUM_STUDY_ROOT)
    files.push(path.join(process.env.STUDIUM_STUDY_ROOT, ".cache/classifier-log.jsonl"));
}
const reports = await Promise.all(
  files.map(async (file) => {
    const text = await readFile(file, "utf8").catch(() => "");
    const rows = text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as ClassifierLogRow];
        } catch {
          return [];
        }
      });
    return { workspace: path.dirname(path.dirname(file)), decisions: summarizeClassifier(rows) };
  }),
);
console.log(JSON.stringify(reports, null, 2));
