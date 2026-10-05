export interface SourceImage {
  url: string;
  alt: string;
  nearHeading: string;
  caption?: string;
  license?: string;
  credit?: string;
}

/** Collect before cleaning; discovery never downloads an image. */
export function collectImages(
  markdown: string,
  pageUrl: string,
  sizes: ReadonlyMap<string, number> = new Map(),
): SourceImage[] {
  const images: SourceImage[] = [];
  const seen = new Set<string>();
  const definitions = new Map<string, string>();
  for (const match of markdown.matchAll(/^ {0,3}\[([^\]^]+)\]:\s*<?([^\s>]+)>?/gm))
    definitions.set((match[1] ?? "").trim().replace(/\s+/g, " ").toLowerCase(), match[2] ?? "");
  let heading = "";
  let fence = "";
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker?.[1]) {
      fence = fence ? "" : (marker[1][0] ?? "");
      continue;
    }
    if (fence) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) heading = h[1] ?? "";
    for (const match of line.matchAll(/!\[([^\]]*)\](?:\(<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\)|\[([^\]]*)\])?/g)) {
      try {
        const src = match[2] ?? definitions.get((match[3] || match[1] || "").trim().replace(/\s+/g, " ").toLowerCase());
        if (!src) continue;
        const url = new URL(src, pageUrl);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          /\.svg$/i.test(url.pathname) ||
          seen.has(url.href)
        )
          continue;
        const size = sizes.get(url.href);
        if (size !== undefined && size < 2048) continue;
        seen.add(url.href);
        images.push({ url: url.href, alt: match[1] ?? "", nearHeading: heading });
        if (images.length === 50) return images;
      } catch {
        /* Malformed image URLs are ignored. */
      }
    }
  }
  return images;
}
