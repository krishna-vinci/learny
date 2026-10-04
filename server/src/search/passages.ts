import { DatabaseSync } from "node:sqlite";
import { selectedPassage } from "../agent/passage.js";
import { readParsedFile, readSource } from "../ingest/library.js";
import { sourceSections } from "../ingest/sections.js";
import { plaintext } from "./plaintext.js";

export interface Passage {
  id: string;
  source: string;
  file: string;
  anchor: string;
  text: string;
  cited: boolean;
  score: number;
  summary?: string;
}

const sourceId = /^lib-[a-z0-9][a-z0-9-]*$/;
/** Shared with ingest so citation anchors and summaries are identical. */
export const splitPassages = sourceSections;

export async function sourcePassages(root: string, sources: readonly string[]): Promise<Passage[]> {
  const result: Passage[] = [];
  for (const source of [...new Set(sources)].filter((s) => sourceId.test(s))) {
    const view = await readSource(root, source);
    const anchors = new Map<string, number>();
    for (const file of view?.parsedFiles ?? []) {
      const text = await readParsedFile(root, source, file);
      if (text === null) continue;
      for (const [index, section] of splitPassages(text, anchors).entries()) {
        result.push({ id: `${source}/${file}#${index}`, source, file, ...section, cited: false, score: 0 });
      }
    }
  }
  return result;
}

/** FTS5 BM25 over passage text, using the same plaintext/tokenizer as workspace search. */
export function rankPassages(passages: readonly Passage[], query: string): Passage[] {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE passages USING fts5(id UNINDEXED, body, tokenize='porter unicode61')");
    const insert = db.prepare("INSERT INTO passages VALUES (?, ?)");
    for (const p of passages) insert.run(p.id, plaintext(p.text));
    const terms = [...new Set(query.match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 40);
    const match = terms.map((t) => `"${t}"`).join(" OR ");
    const rows = match
      ? (db
          .prepare("SELECT id, -bm25(passages) AS score FROM passages WHERE passages MATCH ? ORDER BY score DESC")
          .all(match) as { id: string; score: number }[])
      : [];
    const scores = new Map(rows.map((r) => [r.id, r.score]));
    return passages
      .map((p) => ({ ...p, score: scores.get(p.id) ?? 0 }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  } finally {
    db.close();
  }
}

export function boundPassages(passages: readonly Passage[], maxTokens = 12_000): Passage[] {
  let remaining = Math.max(0, Math.floor(maxTokens * 4));
  const result: Passage[] = [];
  for (const p of passages) {
    let summary = p.summary;
    if (renderPassages([{ ...p, text: "" }]).length + 2 >= remaining) summary = undefined;
    const packedSize = (text: string) => renderPassages([{ ...p, text, summary }]).length + 2;
    const overhead = packedSize("");
    if (remaining <= overhead) break;
    // Account for delimiter escaping, which can increase the packed size.
    let text = p.text.slice(0, remaining - overhead);
    while (text && packedSize(text) > remaining) text = text.slice(0, Math.floor(text.length * 0.9));
    if (!text) continue;
    remaining -= packedSize(text);
    result.push({ ...p, text, summary });
  }
  return result;
}

export async function rankedPassages(
  root: string,
  sources: readonly string[],
  brief: string,
  maxTokens = 12_000,
): Promise<Passage[]> {
  return boundPassages(rankPassages(await sourcePassages(root, sources), brief), maxTokens);
}

/** Anchored citations and ±1 neighbours are never removed or truncated by ranking. */
export async function evidencePack(
  root: string,
  note: string,
  sources: readonly string[],
): Promise<{ passages: Passage[]; missing: string[] }> {
  const citations = [...note.matchAll(/\[\^src:(lib-[a-z0-9-]+)(?:#([^\]\s]+))?\]/g)];
  const all = await sourcePassages(root, [...sources, ...citations.map((c) => c[1] ?? "")]);
  const kept = new Map<string, Passage>();
  const missing: string[] = [];
  for (const citation of citations) {
    const source = citation[1];
    const anchor = citation[2];
    const candidates = all.filter((p) => p.source === source);
    const hits = candidates.filter(
      (p) => anchor && (p.anchor === anchor || p.file.replace(/\.md$/, "").split("/").at(-1) === anchor),
    );
    if (!hits.length) {
      missing.push(`${source}${anchor ? `#${anchor}` : " (unanchored)"}`);
      for (const p of boundPassages(rankPassages(candidates, note), 3000)) kept.set(p.id, { ...p, cited: true });
      continue;
    }
    for (const hit of hits) {
      const siblings = candidates.filter((p) => p.file === hit.file);
      const i = siblings.findIndex((p) => p.id === hit.id);
      for (const p of siblings.slice(Math.max(0, i - 1), i + 2)) kept.set(p.id, { ...p, cited: true });
    }
  }
  if (!citations.length) {
    missing.push("No inline source citations; inspect the listed sources with study_read.");
    for (const p of boundPassages(rankPassages(all, note), 12_000)) kept.set(p.id, p);
  }
  return { passages: [...kept.values()], missing };
}

export function renderPassages(passages: readonly Passage[]): string {
  return passages
    .map((p) =>
      selectedPassage(
        `${p.summary ? `Section summary: ${p.summary}\n\n` : ""}${p.text}`,
        `${p.source}/${p.file}#${p.anchor}`,
      ),
    )
    .join("\n\n");
}
