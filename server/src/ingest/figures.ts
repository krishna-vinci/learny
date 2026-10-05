import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { parseHTML } from "linkedom";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";
import { MAX_IMAGE_BYTES, sniffImage } from "./image-bytes.js";
import type { SourceImage } from "./images.js";
import { safeFetch } from "./safe-fetch.js";

export interface SourceFigure {
  /** Source-directory-relative local path; absent on legacy/failed downloads. */
  path?: string;
  url: string;
  alt: string;
  caption: string;
  section: string;
  license?: string;
  credit: string;
}

export function reusableLicense(license: string | undefined): boolean {
  return !!license && /^(?:CC BY(?:-SA)?(?: \d(?:\.\d)?)?|CC0(?: \d(?:\.\d)?)?|public domain)$/i.test(license.trim());
}

/** Explicit license statements only. A host's reputation is not permission. */
export function figureLicense(text: string): string | undefined {
  const url =
    /https?:\/\/creativecommons\.org\/(?:licenses\/(by(?:-(?:nc|nd|sa))*)\/(\d\.\d)|publicdomain\/(zero|mark)\/1\.0)\/?/i.exec(
      text,
    );
  if (url) return url[1] ? `CC ${url[1].toUpperCase()} ${url[2]}` : url[3] === "zero" ? "CC0 1.0" : "public domain";
  const label = /\b(CC BY(?:-(?:NC|ND|SA))*(?: \d\.\d)?|CC0(?: \d\.\d)?|public domain)\b/i.exec(text)?.[1];
  return label;
}

function confined(root: string, rel: string): string {
  if (canonicalRel(root, rel) !== rel) throw new Error("Figure paths may not be symlink aliases");
  return resolveInRoot(root, rel);
}

/** Read both images.json generations; malformed metadata never supplies permission. */
export async function readSourceFigures(root: string, id: string): Promise<SourceFigure[]> {
  if (!/^lib-[a-z0-9][a-z0-9-]*$/.test(id)) return [];
  const rel = `library/${id}/images.json`;
  let items: unknown;
  try {
    items = JSON.parse(await fs.readFile(confined(root, rel), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.url !== "string") return [];
    const local =
      typeof item.path === "string" && /^figures\/[a-f0-9]{24}\.(?:png|jpg|gif|webp)$/.test(item.path)
        ? item.path
        : undefined;
    return [
      {
        ...(local ? { path: local } : {}),
        url: item.url,
        alt: typeof item.alt === "string" ? item.alt : "",
        caption: typeof item.caption === "string" ? item.caption : typeof item.alt === "string" ? item.alt : "",
        section:
          typeof item.section === "string"
            ? item.section
            : typeof item.nearHeading === "string"
              ? item.nearHeading
              : "",
        ...(typeof item.license === "string" ? { license: item.license } : {}),
        credit: typeof item.credit === "string" ? item.credit : item.url,
      },
    ];
  });
}

async function commonsMetadata(
  url: string,
  signal?: AbortSignal,
): Promise<{ license?: string; credit: string } | undefined> {
  const parsed = new URL(url);
  if (
    !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/wikipedia/commons/")
  )
    return undefined;
  const segments = parsed.pathname.split("/");
  // Thumbnails include a final size-prefixed filename; the previous segment is the original.
  const filename = decodeURIComponent(
    segments[parsed.pathname.includes("/thumb/") ? segments.length - 2 : segments.length - 1] ?? "",
  );
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "extmetadata",
    titles: `File:${filename}`,
  }))
    api.searchParams.set(key, value);
  const response = await safeFetch(api.href, { maxBytes: 256 * 1024, httpsOnly: true, signal });
  const data = JSON.parse(Buffer.from(response.bytes).toString("utf8"));
  for (const page of Object.values(data.query?.pages ?? {}) as {
    imageinfo?: { extmetadata?: Record<string, { value?: string }> }[];
  }[]) {
    const meta = page.imageinfo?.[0]?.extmetadata;
    const license = figureLicense(`${meta?.LicenseUrl?.value ?? ""} ${meta?.LicenseShortName?.value ?? ""}`);
    if (meta) {
      const artist = (
        parseHTML(`<div>${meta.Artist?.value ?? meta.Attribution?.value ?? ""}</div>`).document.querySelector("div")
          ?.textContent ?? ""
      )
        .trim()
        .slice(0, 1000);
      return {
        ...(license ? { license } : {}),
        credit: `${artist || "Wikimedia Commons"}, https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`,
      };
    }
  }
  return undefined;
}

/** Stage downloads before publication so ingest/refresh owns locking and rollback. */
export async function captureFigures(input: {
  images: readonly SourceImage[];
  title: string;
  authors: readonly string[];
  pageUrl: string | null;
  markdown: string;
  signal?: AbortSignal;
}): Promise<{ figures: SourceFigure[]; files: Map<string, Uint8Array> }> {
  const files = new Map<string, Uint8Array>();
  const figures: SourceFigure[] = [];
  const seen = new Set<string>();
  const words = new Set(input.markdown.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const ranked = input.images
    .filter((image) => {
      if (
        seen.has(image.url) ||
        /\b(?:logo|icon|avatar|advertisement|tracking|pixel|banner|cookie)\b|(?:^|[/_-])(?:logo|icon|ads?|tracking|pixel)(?:[/_.-]|$)/i.test(
          `${image.alt} ${image.caption ?? ""} ${image.url}`,
        )
      )
        return false;
      seen.add(image.url);
      return !!(image.caption || image.alt || image.nearHeading);
    })
    .map((image) => ({
      image,
      score: (
        `${image.caption ?? ""} ${image.alt} ${image.nearHeading}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []
      ).filter((word) => words.has(word)).length,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const { image } of ranked.slice(0, 12)) {
    input.signal?.throwIfAborted();
    let license = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//i.test(image.url)
      ? undefined
      : image.license;
    let attribution = image.credit ?? `${input.authors.join(", ") || input.title}, ${input.pageUrl ?? image.url}`;
    try {
      const commons = await commonsMetadata(image.url, input.signal);
      if (commons) {
        // A source page's prose license does not license a separately credited Commons file.
        license = commons.license;
        attribution = commons.credit;
      }
    } catch {
      input.signal?.throwIfAborted();
    }
    const caption = image.caption || image.alt;
    const credit = `${attribution}${license ? ` (${license})` : " (reuse license unknown; redraw)"}`;
    const figure: SourceFigure = {
      url: image.url,
      alt: image.alt,
      caption,
      section: image.nearHeading,
      ...(license ? { license } : {}),
      credit,
    };
    try {
      const response = await safeFetch(image.url, { maxBytes: MAX_IMAGE_BYTES, httpsOnly: true, signal: input.signal });
      const info = sniffImage(response.bytes);
      if (
        response.bytes.length > MAX_IMAGE_BYTES ||
        response.contentType?.split(";")[0]?.trim().toLowerCase() !== info.mime ||
        info.width < 64 ||
        info.height < 64 ||
        info.width > 6000 ||
        info.height > 6000
      )
        throw new Error("Invalid figure size or MIME");
      figure.path = `figures/${createHash("sha256").update(response.bytes).digest("hex").slice(0, 24)}.${info.ext}`;
      files.set(figure.path, response.bytes);
    } catch {
      input.signal?.throwIfAborted();
    }
    figures.push(figure);
  }
  return { figures, files };
}
