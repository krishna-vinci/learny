import type { Passage } from "../search/passages.js";
import type { Classifier } from "./classifier.js";

export async function selectContext(
  classifier: Classifier,
  passages: Passage[],
  brief: string,
  topK = 8,
  fallback: Passage[] = passages,
): Promise<Passage[]> {
  // Bounded previews for routing; the LLM receives original retrieved passages.
  const result = await classifier.decide("context.relevance", {
    state: {
      brief: brief.slice(0, 2000),
      candidates: passages.slice(0, 20).map((p) => ({ id: p.id, text: p.text.slice(0, 900), cited: p.cited })),
    },
  });
  if (result.source !== "classifier") return fallback;
  const selected = passages
    .filter((p) => result.answer[p.id] === true && !p.cited)
    .sort((a, b) => (result.probabilities[b.id] ?? 0) - (result.probabilities[a.id] ?? 0))
    .slice(0, topK);
  // An empty/unknown classifier selection cannot erase the fallback evidence.
  if (!selected.length) return fallback;
  const keep = new Set([...selected.map((p) => p.id), ...passages.filter((p) => p.cited).map((p) => p.id)]);
  return passages.filter((p) => keep.has(p.id));
}
