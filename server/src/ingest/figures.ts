import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { figureLicense, licenseUrl, plainCredit } from "./image-license.js";

export { figureLicense, reusableLicense } from "./image-license.js";

import { canonicalRel, resolveInRoot } from "../tree/paths.js";
import { MAX_IMAGE_BYTES, MIN_IMAGE_PIXELS, sniffImage } from "./image-bytes.js";
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
  creator?: string;
  licenseUrl?: string;
  sourcePage?: string;
  width?: number;
  height?: number;
  downloadError?: string;
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
        ...(typeof item.creator === "string" ? { creator: item.creator } : {}),
        ...(typeof item.licenseUrl === "string" ? { licenseUrl: item.licenseUrl } : {}),
        ...(typeof item.sourcePage === "string" ? { sourcePage: item.sourcePage } : {}),
        ...(typeof item.width === "number" ? { width: item.width } : {}),
        ...(typeof item.height === "number" ? { height: item.height } : {}),
        credit: typeof item.credit === "string" ? item.credit : item.url,
        ...(typeof item.downloadError === "string" ? { downloadError: item.downloadError } : {}),
      },
    ];
  });
}

export async function commonsMetadata(
  url: string,
  signal?: AbortSignal,
): Promise<
  | { license?: string; credit: string; creator: string; sourcePage: string; licenseUrl?: string; originalUrl?: string }
  | undefined
> {
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
    iiprop: "extmetadata|url|size",
    titles: `File:${filename}`,
  }))
    api.searchParams.set(key, value);
  const response = await safeFetch(api.href, { maxBytes: 256 * 1024, httpsOnly: true, signal });
  const data = JSON.parse(Buffer.from(response.bytes).toString("utf8"));
  for (const page of Object.values(data.query?.pages ?? {}) as {
    imageinfo?: { url?: string; extmetadata?: Record<string, { value?: string }> }[];
  }[]) {
    const meta = page.imageinfo?.[0]?.extmetadata;
    const license = figureLicense(`${meta?.LicenseUrl?.value ?? ""} ${meta?.LicenseShortName?.value ?? ""}`);
    if (meta) {
      const artist = plainCredit(`${meta.Artist?.value ?? meta.Attribution?.value ?? ""} ${meta.Credit?.value ?? ""}`);
      const sourcePage = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`;
      return {
        ...(license ? { license } : {}),
        originalUrl: page.imageinfo?.[0]?.url,
        creator: artist || "Wikimedia Commons",
        sourcePage,
        licenseUrl: meta.LicenseUrl?.value || licenseUrl(license),
        credit: `${artist || "Wikimedia Commons"}, ${sourcePage}`,
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
      // Every non-decorative image is a content candidate; labels/overlap only order the queue.
      return true;
    })
    .map((image) => ({
      image,
      score: (
        `${image.caption ?? ""} ${image.alt} ${image.nearHeading}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []
      ).filter((word) => words.has(word)).length,
    }))
    .sort((a, b) => b.score - a.score);
  // Capture every content figure (best-label overlap first); decorative and tiny filters still cut the rest.
  for (const { image } of ranked) {
    input.signal?.throwIfAborted();
    let license = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//i.test(image.url)
      ? undefined
      : image.license;
    let imageUrl = image.url;
    let metadata = {
      creator: image.creator ?? (input.authors.join(", ") || input.title),
      sourcePage: image.sourcePage ?? input.pageUrl ?? image.url,
      licenseUrl: image.licenseUrl ?? licenseUrl(license),
    };
    let attribution = image.credit ?? `${input.authors.join(", ") || input.title}, ${input.pageUrl ?? image.url}`;
    try {
      const commons = await commonsMetadata(image.url, input.signal);
      if (commons) {
        // A source page's prose license does not license a separately credited Commons file.
        license = commons.license;
        attribution = commons.credit;
        if (/-ND/i.test(commons.license ?? "") && commons.originalUrl) imageUrl = commons.originalUrl;
        metadata = { creator: commons.creator, sourcePage: commons.sourcePage, licenseUrl: commons.licenseUrl };
      }
    } catch {
      input.signal?.throwIfAborted();
    }
    const caption = image.caption || image.alt;
    const credit = `${attribution}${license ? ` (${license})` : " (licence unknown)"}`;
    const figure: SourceFigure = {
      url: imageUrl,
      alt: image.alt,
      caption,
      section: image.nearHeading,
      ...metadata,
      ...(license ? { license } : {}),
      credit,
    };
    try {
      const response = await safeFetch(imageUrl, { maxBytes: MAX_IMAGE_BYTES, httpsOnly: true, signal: input.signal });
      const info = sniffImage(response.bytes);
      if (
        response.bytes.length > MAX_IMAGE_BYTES ||
        response.contentType?.split(";")[0]?.trim().toLowerCase() !== info.mime ||
        Math.max(info.width, info.height) < MIN_IMAGE_PIXELS ||
        info.width > 6000 ||
        info.height > 6000
      )
        throw new Error("Invalid figure size or MIME");
      figure.width = info.width;
      figure.height = info.height;
      figure.path = `figures/${createHash("sha256").update(response.bytes).digest("hex").slice(0, 24)}.${info.ext}`;
      files.set(figure.path, response.bytes);
    } catch (error) {
      input.signal?.throwIfAborted();
      figure.downloadError = (error instanceof Error ? error.message : "Figure download failed").slice(0, 500);
    }
    figures.push(figure);
  }
  return { figures, files };
}
