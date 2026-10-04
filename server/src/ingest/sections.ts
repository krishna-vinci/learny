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
