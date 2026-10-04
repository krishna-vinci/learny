import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseYoutubeVideo } from "@studium/shared/media";

/** Directory (study-root relative) that holds every `library/<src-id>/` folder. */
export const LIBRARY_DIR = "library";
/** Study-tree ids stay short so they read cleanly in citations: `[^src:<id>]`. */
export const MAX_ID_LENGTH = 48;

const ARXIV_ID = /(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/;
const ARXIV_ID_ANCHORED = new RegExp(`^(?:${ARXIV_ID.source})$`);
const DOI_VALUE = /^10\.\d{4,9}\/\S+$/;
// Query parameters that never change which document a URL points at.
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "ref", "source"]);
// Placeholder authors that should never drive an id; the site label is better.
const GENERIC_AUTHORS = new Set(["wikipedia contributors"]);
// Second-level domains that are part of the public suffix, not the site name.
const SECOND_LEVEL_TLDS = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Lowercase kebab-case slug of arbitrary text. Diacritics are folded to ASCII
 * and the result is trimmed at a word boundary so it never ends with `-`.
 */
export function slugify(text: string, maxLength = 40): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length <= maxLength) return ascii;
  const cut = ascii.slice(0, maxLength);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

/** Registrable site name: `en.wikipedia.org`/`www.nature.com` -> `wikipedia`/`nature`. */
export function siteLabel(hostname: string): string {
  const labels = hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter((label) => label !== "");
  // Drop a leading language subdomain such as the `en` in `en.wikipedia.org`.
  if (labels.length >= 3 && /^[a-z]{2}(?:-[a-z0-9]+)?$/.test(labels[0] ?? "")) labels.shift();
  let label = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  // `example.co.uk` -> `example`, not the second-level `co`.
  if (label !== undefined && SECOND_LEVEL_TLDS.has(label) && labels.length >= 3) {
    label = labels[labels.length - 3];
  }
  return slugify((label ?? "").replace(/\./g, "-"), 24);
}

// `<author-or-site>`: the first author's last name, else the site hostname.
function authorToken(authors: string[], url: string | null): string {
  for (const author of authors) {
    if (GENERIC_AUTHORS.has(author.trim().toLowerCase())) continue;
    const words = author.trim().split(/\s+/);
    const last = words[words.length - 1] ?? "";
    const slug = slugify(last, 24);
    if (slug !== "") return slug;
  }
  if (url !== null) {
    try {
      return siteLabel(new URL(url).hostname);
    } catch {
      // Not a URL: fall through to an author-less id.
    }
  }
  return "";
}

function truncateId(value: string): string {
  if (value.length <= MAX_ID_LENGTH) return value;
  const cut = value.slice(0, MAX_ID_LENGTH);
  const trimmed = cut.replace(/-[^-]*$/, "");
  return (trimmed === "" ? cut : trimmed).replace(/-+$/, "");
}

/** `lib-<author-or-site>-<short-title>` (decision 8), before collision suffixes. */
export function sourceIdBase(input: { authors: string[]; title: string | null; url: string | null }): string {
  const segments: string[] = [];
  const author = authorToken(input.authors, input.url);
  if (author !== "") segments.push(author);
  const title = input.title === null ? "" : slugify(input.title, 40);
  if (title !== "") segments.push(title);
  if (segments.length === 0) segments.push("source");
  return truncateId(`lib-${segments.join("-")}`);
}

/** Append `-2`, `-3`, ... until `<root>/library/<id>` does not already exist. */
export async function uniqueSourceId(root: string, base: string): Promise<string> {
  const dir = path.join(root, LIBRARY_DIR);
  for (let suffix = 1; suffix <= 999; suffix++) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    try {
      await fs.access(path.join(dir, id));
    } catch {
      return id;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface DedupeKey {
  sha256?: string | null;
  /** Already normalized (see {@link normalizeUrl}). */
  url?: string | null;
  arxivId?: string | null;
  doi?: string | null;
}

/** Lowercased, tracking-param-free URL used for dedupe comparisons. */
export function normalizeUrl(value: string): string {
  const video = parseYoutubeVideo(value);
  if (video) return `https://www.youtube.com/watch?v=${video.id}`;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return value.trim();
  }
  url.hash = "";
  // Explicit AMP variants are mirrors of the same article.
  url.pathname = url.pathname.replace(/\/amp\/?$/, "");
  url.searchParams.delete("amp");
  if (url.hostname.startsWith("amp.")) url.hostname = url.hostname.slice(4);
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

/**
 * arXiv identifier from an exact `arxiv.org` `/abs/<id>` or `/pdf/<id>` URL, or
 * from a bare identifier input. Arbitrary hosts and stray substrings yield null.
 */
export function arxivIdOf(value: string): string | null {
  const trimmed = value.trim();
  let candidate: string;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== "arxiv.org") return null;
    const path = /^\/(?:abs|pdf|html)\/([^?#]+)$/.exec(url.pathname);
    if (path?.[1] === undefined) return null;
    candidate = decodeArxivSegment(path[1]);
  } else {
    candidate = trimmed
      .replace(/^arxiv:/i, "")
      .replace(/\.pdf$/i, "")
      .trim();
  }
  return ARXIV_ID_ANCHORED.test(candidate) ? candidate : null;
}

function decodeArxivSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment when it is not valid percent-encoding.
  }
  return decoded.replace(/\.pdf$/i, "").trim();
}

export function doiOf(value: string): string | null {
  const fromUrl = /doi\.org\/(10\.[^\s?#]+)/i.exec(value);
  let candidate = fromUrl?.[1] ?? value.trim();
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Keep the raw candidate when it is not valid percent-encoding.
  }
  return DOI_VALUE.test(candidate) ? candidate.toLowerCase() : null;
}

/** Dedupe key for an incoming URL or identifier (before extraction). */
export function dedupeKeyFromUrl(url: string): DedupeKey {
  return {
    url: normalizeUrl(url),
    arxivId: arxivIdOf(url),
    doi: doiOf(url),
  };
}

/** Dedupe key for a stored `source.md` frontmatter block. */
export function dedupeKeyFromSource(frontmatter: Record<string, unknown>): DedupeKey {
  const sha256 = typeof frontmatter.sha256 === "string" ? frontmatter.sha256 : null;
  const rawUrl = typeof frontmatter.url === "string" ? frontmatter.url : null;
  return {
    sha256,
    url: rawUrl === null ? null : normalizeUrl(rawUrl),
    arxivId: rawUrl === null ? null : arxivIdOf(rawUrl),
    doi: rawUrl === null ? null : doiOf(rawUrl),
  };
}

/** True when the two keys identify the same source on any comparable field. */
export function keysMatch(a: DedupeKey, b: DedupeKey): boolean {
  return (
    presentEqual(a.sha256, b.sha256) ||
    presentEqual(a.url, b.url) ||
    presentEqual(a.arxivId, b.arxivId) ||
    presentEqual(a.doi, b.doi)
  );
}

function presentEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === "string" && a !== "" && typeof b === "string" && b !== "" && a === b;
}
