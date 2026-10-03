import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { CALLOUT_NAMES } from "./formatting";

export interface CitationSource {
  id: string;
  title: string;
}

interface TriggerMatch {
  /** Document-relative-to-line offset where the completed text starts. */
  from: number;
  /** What's already typed since the trigger, used to rank/filter options. */
  typed: string;
}

/** `[^src:` not yet closed by `]` on this line, up to `pos`. */
export function matchCitationTrigger(line: string, pos: number): TriggerMatch | null {
  const prefix = "[^src:";
  const idx = line.lastIndexOf(prefix, pos);
  if (idx < 0) return null;
  const from = idx + prefix.length;
  if (from > pos) return null;
  const between = line.slice(from, pos);
  if (between.includes("]") || between.includes("[")) return null;
  return { from, typed: between };
}

/** Inside `::visual{src="../visuals/`, before the closing quote, up to `pos`. */
export function matchVisualTrigger(line: string, pos: number): TriggerMatch | null {
  const prefix = '::visual{src="../visuals/';
  const idx = line.lastIndexOf(prefix, pos);
  if (idx < 0) return null;
  const from = idx + prefix.length;
  if (from > pos) return null;
  const between = line.slice(from, pos);
  if (between.includes('"')) return null;
  return { from, typed: between };
}

/** `:::` at the very start of the line, optionally followed by a partial callout name. */
export function matchCalloutTrigger(line: string, pos: number): TriggerMatch | null {
  const m = /^:::([a-zA-Z]*)$/.exec(line.slice(0, pos));
  if (!m) return null;
  return { from: 3, typed: m[1] ?? "" };
}

/** Rank candidates by where `typed` (lower-cased) is found in their label: a prefix match
 * outranks one found later, ties broken alphabetically. Candidates that don't contain
 * `typed` at all are dropped. */
function rank<T>(items: T[], typed: string, label: (item: T) => string): T[] {
  const needle = typed.toLowerCase();
  return items
    .map((item) => ({ item, label: label(item), lower: label(item).toLowerCase() }))
    .filter(({ lower }) => lower.includes(needle))
    .sort((a, b) => {
      const ai = a.lower.indexOf(needle);
      const bi = b.lower.indexOf(needle);
      return ai !== bi ? ai - bi : a.label.localeCompare(b.label);
    })
    .map(({ item }) => item);
}

function triggerSource(
  match: (line: string, pos: number) => TriggerMatch | null,
  options: (typed: string) => CompletionResult["options"],
): CompletionSource {
  return (ctx: CompletionContext) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const found = match(line.text, ctx.pos - line.from);
    if (!found) return null;
    const list = options(found.typed);
    if (list.length === 0) return null;
    return { from: line.from + found.from, options: list, filter: false };
  };
}

export function citationCompletionSource(sources: CitationSource[]): CompletionSource {
  return triggerSource(matchCitationTrigger, (typed) =>
    rank(sources, typed, (s) => s.id).map((s) => ({ label: s.id, detail: s.title, type: "constant" })),
  );
}

export function visualCompletionSource(files: string[]): CompletionSource {
  return triggerSource(matchVisualTrigger, (typed) =>
    rank(files, typed, (f) => f).map((f) => ({ label: f, type: "file" })),
  );
}

export function calloutCompletionSource(): CompletionSource {
  return triggerSource(matchCalloutTrigger, (typed) =>
    rank(CALLOUT_NAMES, typed, (n) => n).map((n) => ({ label: n, type: "keyword" })),
  );
}

/** The editor's full autocompletion extension, built from data fetched once per editor open. */
export function noteCompletions(sources: CitationSource[], visualFiles: string[]): Extension {
  return autocompletion({
    override: [citationCompletionSource(sources), visualCompletionSource(visualFiles), calloutCompletionSource()],
  });
}
