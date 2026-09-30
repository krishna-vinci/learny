/** Whitespace can change when a note is edited or Markdown is rendered. Map normalized
 * offsets back to the original string, preserving exact DOM boundaries. */
function normalize(text: string) {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const character = text[i] ?? "";
    if (/\s/.test(character)) {
      if (value.endsWith(" ")) {
        ends[ends.length - 1] = i + 1;
        continue;
      }
      value += " ";
    } else value += character;
    starts.push(i);
    ends.push(i + 1);
  }
  return { value, starts, ends };
}

export function locateQuote(
  text: string,
  quote: string,
  prefix = "",
  suffix = "",
): { start: number; end: number } | null {
  const haystack = normalize(text);
  const needle = normalize(quote).value.trim();
  if (!needle) return null;
  const before = normalize(prefix).value;
  const after = normalize(suffix).value;
  const matches: { at: number; score: number }[] = [];
  let from = 0;
  while (from <= haystack.value.length) {
    const at = haystack.value.indexOf(needle, from);
    if (at < 0) break;
    const score =
      (before && haystack.value.slice(0, at).endsWith(before) ? before.length : 0) +
      (after && haystack.value.slice(at + needle.length).startsWith(after) ? after.length : 0);
    matches.push({ at, score });
    from = at + 1;
  }
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  // Ambiguous matches stay unplaced instead of silently highlighting a wrong passage.
  if (!best || (matches[1] && matches[1].score === best.score)) return null;
  return { start: haystack.starts[best.at] ?? 0, end: haystack.ends[best.at + needle.length - 1] ?? text.length };
}
