export interface SourceSection {
  anchor: string;
  text: string;
  summary: string;
}
export const sectionSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
export function sectionSummary(text: string): string {
  const prose = text
    .replace(/^#{1,6} .*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (prose.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? prose).trim().slice(0, 240);
}
/** Preserve transcript times and real headings. Duplicate heading anchors remain deterministic. */
export function sourceSections(text: string, seen = new Map<string, number>()): SourceSection[] {
  const sections: SourceSection[] = [];
  let anchor = "start";
  let lines: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    const value = lines.join("\n").trim();
    if (value) sections.push({ anchor, text: value, summary: sectionSummary(value) });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const preserved = !fence ? /^<!-- anchor: ([\p{L}\p{N}][\p{L}\p{N}_.:-]*) -->$/u.exec(line)?.[1] : undefined;
    if (preserved) {
      anchor = preserved;
      lines.push(line);
      continue;
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    const heading = !fence ? /^#{1,6}\s+(.+)$/.exec(line)?.[1] : undefined;
    const location = !fence ? /<!--\s*([pt]):\s*(\d+)\s*-->|<a\s+(?:id|name)=["']([^"']+)["']/.exec(line) : null;
    if (heading || location) {
      flush();
      const base = heading ? sectionSlug(heading) : (location?.[3] ?? `${location?.[1]}${location?.[2]}`);
      const count = seen.get(base) ?? 0;
      anchor = count ? `${base}-${count}` : base;
      seen.set(base, count + 1);
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/** Keep locators for matching sections even when duplicates move or headings change. */
export function preserveSectionAnchors(before: string, after: string): { markdown: string; disappeared: string[] } {
  const old = sourceSections(before);
  const next = sourceSections(after);
  const used = new Set<string>();
  const matched = new Set<string>();
  const prose = (text: string) =>
    text
      .replace(/^#{1,6} .*$/gm, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<a\s+(?:id|name)=[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const assigned = next.map((section) => {
    const available = old.filter((s) => !matched.has(s.anchor));
    const exact = available.find((s) => prose(s.text) && prose(s.text) === prose(section.text));
    const heading = /^#{1,6}\s+(.+)$/m.exec(section.text)?.[1];
    const sameHeading = heading ? available.filter((s) => /^#{1,6}\s+(.+)$/m.exec(s.text)?.[1] === heading) : [];
    const match = exact ?? (sameHeading.length === 1 ? sameHeading[0] : undefined);
    if (match) matched.add(match.anchor);
    return { section, preferred: match?.anchor };
  });
  for (const item of assigned) if (item.preferred) used.add(item.preferred);
  const markdown = assigned
    .map(({ section, preferred }) => {
      let anchor = preferred ?? section.anchor;
      if (!preferred) {
        let suffix = 1;
        while (used.has(anchor)) anchor = `${section.anchor}-new-${suffix++}`;
        used.add(anchor);
      }
      const text = section.text.replace(/^<!-- anchor: [\p{L}\p{N}_.:-]+ -->\n?/gmu, "");
      const lines = text.split("\n");
      const position = /^#{1,6}\s/.test(lines[0] ?? "") ? 1 : 0;
      lines.splice(position, 0, `<!-- anchor: ${anchor} -->`);
      return lines.join("\n");
    })
    .join("\n\n");
  return { markdown: `${markdown}\n`, disappeared: old.filter((s) => !matched.has(s.anchor)).map((s) => s.anchor) };
}
