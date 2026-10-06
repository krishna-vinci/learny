import { parseHTML } from "linkedom";

export interface SourceImage {
  url: string;
  alt: string;
  nearHeading: string;
  caption?: string;
  license?: string;
  credit?: string;
  creator?: string;
  sourcePage?: string;
  licenseUrl?: string;
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

/** Inspect the original DOM before Readability/Turndown discard image-only content. */
export function collectHtmlImages(html: string, pageUrl: string): SourceImage[] {
  const { document } = parseHTML(html);
  const images: SourceImage[] = [];
  const seen = new Set<string>();
  let heading = "";
  let context = "";
  for (const node of document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,img")) {
    if (node.closest("nav,footer,header,script,style")) continue;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (/^H[1-6]$/.test(node.tagName)) heading = text;
    // Older educational pages use bold paragraphs as headings and unlabeled diagrams.
    if (node.tagName === "P" && text && !node.querySelector("img")) {
      context = text.slice(0, 500);
      if (node.querySelector("b,strong") && text.length < 100) heading = text;
    }
    if (node.tagName !== "IMG") continue;
    const width = Number(node.getAttribute("width")),
      height = Number(node.getAttribute("height"));
    if ((width > 0 && width < 64) || (height > 0 && height < 64)) continue;
    const set: string | null | undefined =
      node.getAttribute("data-srcset") ||
      node.getAttribute("srcset") ||
      node.closest("picture")?.querySelector("source")?.getAttribute("srcset");
    const src =
      node.getAttribute("data-src") ||
      node.getAttribute("data-lazy-src") ||
      set
        ?.split(",")
        .map((s) => s.trim().split(/\s+/)[0])
        .filter(Boolean)
        .at(-1) ||
      node.getAttribute("src");
    if (!src) continue;
    try {
      const url = new URL(src, pageUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        /\.svg$/i.test(url.pathname) ||
        seen.has(url.href)
      )
        continue;
      const caption =
        node.closest("figure")?.querySelector("figcaption")?.textContent?.replace(/\s+/g, " ").trim() ||
        node.closest(".wp-caption")?.querySelector(".wp-caption-text")?.textContent?.replace(/\s+/g, " ").trim();
      const alt = node.getAttribute("alt") || "";
      seen.add(url.href);
      images.push({
        url: url.href,
        alt,
        nearHeading: heading,
        ...(caption || (!alt && context) ? { caption: caption || context } : {}),
      });
      if (images.length === 50) break;
    } catch {
      /* Invalid image URLs never enter discovery. */
    }
  }
  return images;
}
