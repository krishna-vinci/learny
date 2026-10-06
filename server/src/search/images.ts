import {
  embeddableLicense,
  figureLicense,
  licenseUrl,
  type MediaLicensePolicy,
  plainCredit,
} from "../ingest/image-license.js";
import { safeFetch } from "../ingest/safe-fetch.js";
import { htmlToMarkdown } from "../ingest/web.js";
import type { SearchResult } from "./backends.js";

export type ImageBackend = "commons" | "openverse" | "met" | "nasa" | "smithsonian" | "exa" | "source";
export interface ImageCandidate {
  url: string;
  thumbnail: string;
  title: string;
  creator: string;
  license?: string;
  licenseUrl?: string;
  sourcePage: string;
  width?: number;
  height?: number;
  description: string;
  tags: string[];
  backend: ImageBackend;
  sourceId?: string;
  path?: string;
}
type Row = Record<string, unknown>;
const row = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(row) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const value = (v: unknown): string => str(row(v).value);
function https(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function normalizeImageResults(data: unknown, backend: ImageBackend): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const add = (c: Omit<ImageCandidate, "backend">) => {
    if (https(c.url) && https(c.sourcePage) && !/\.svg(?:\?|$)/i.test(c.url)) candidates.push({ ...c, backend });
  };
  const d = row(data);
  if (backend === "commons")
    for (const page of Object.values(row(row(d.query).pages))) {
      const p = row(page),
        info = rows(p.imageinfo)[0] ?? {},
        meta = row(info.extmetadata);
      const license = figureLicense(`${value(meta.LicenseUrl)} ${value(meta.LicenseShortName)}`);
      // ND must use the original bytes, never a derivative thumbnail.
      const useThumb = !/-ND/i.test(license ?? "") && str(info.thumburl);
      add({
        url: str(useThumb || info.url),
        thumbnail: str(info.thumburl || info.url),
        title: str(p.title).replace(/^File:/, ""),
        creator: plainCredit(`${value(meta.Artist)} ${value(meta.Credit)}`) || "Wikimedia Commons",
        license,
        licenseUrl: value(meta.LicenseUrl) || licenseUrl(license),
        sourcePage: str(info.descriptionurl),
        width: num(useThumb ? info.thumbwidth : info.width),
        height: num(useThumb ? info.thumbheight : info.height),
        description: plainCredit(value(meta.ImageDescription)),
        tags: plainCredit(value(meta.Categories)).split("|"),
      });
    }
  if (backend === "openverse")
    for (const p of rows(d.results)) {
      const label = str(p.license).toLowerCase();
      const license =
        label === "pdm"
          ? "public domain"
          : label === "cc0"
            ? "CC0 1.0"
            : figureLicense(`CC ${label.toUpperCase()} ${str(p.license_version)}`);
      if (p.mature === true) continue;
      add({
        url: str(p.url),
        thumbnail: str(p.thumbnail || p.url),
        title: str(p.title),
        creator: str(p.creator) || str(p.source),
        license,
        licenseUrl: str(p.license_url) || licenseUrl(license),
        sourcePage: str(p.foreign_landing_url),
        width: num(p.width),
        height: num(p.height),
        description: str(p.title),
        tags: rows(p.tags).map((t) => str(t.name)),
      });
    }
  if (backend === "met" && d.isPublicDomain === true)
    add({
      url: str(d.primaryImage),
      thumbnail: str(d.primaryImageSmall || d.primaryImage),
      title: str(d.title),
      creator: str(d.artistDisplayName) || `The Metropolitan Museum of Art${d.culture ? ` (${str(d.culture)})` : ""}`,
      license: "CC0 1.0",
      licenseUrl: licenseUrl("CC0 1.0"),
      sourcePage: str(d.objectURL),
      description: [d.title, d.objectName, d.medium, d.culture, d.period].map(str).join(" "),
      tags: rows(d.tags).map((t) => str(t.term)),
    });
  if (backend === "nasa")
    for (const p of rows(row(d.collection).items)) {
      const info = rows(p.data)[0] ?? {},
        credit =
          str(info.photographer) ||
          str(info.secondary_creator) ||
          (/^(?:ARC|AFRC|GRC|GSFC|HQ|JPL|JSC|KSC|LaRC|MSFC|SSC)$/i.test(str(info.center))
            ? `NASA/${str(info.center)}`
            : str(info.center));
      const description = str(info.description);
      // NASA hosts third-party copyrighted work too; only NASA-attributed material is reusable.
      const own =
        /^NASA\b/i.test(credit) &&
        !/copyright|©|all rights reserved|ESA|Getty|Reuters/i.test(`${credit} ${description}`);
      const url = str(rows(p.links).find((l) => l.rel === "preview")?.href);
      add({
        url,
        thumbnail: url,
        title: str(info.title),
        creator: credit || "Unknown creator",
        ...(own
          ? { license: "public domain", licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/" }
          : {}),
        sourcePage: `https://images.nasa.gov/details/${encodeURIComponent(str(info.nasa_id))}`,
        description,
        tags: Array.isArray(info.keywords) ? info.keywords.map(str) : [],
      });
    }
  if (backend === "smithsonian")
    for (const p of rows(row(d.response).rows)) {
      const content = row(p.content),
        descriptive = row(content.descriptiveNonRepeating),
        freetext = row(content.freetext);
      for (const image of rows(row(descriptive.online_media).media)) {
        if (image.type !== "Images" || str(row(image.usage).access).toUpperCase() !== "CC0") continue;
        add({
          url: str(image.content),
          thumbnail: str(image.thumbnail || image.content),
          title: str(p.title) || str(row(descriptive.title).content),
          creator:
            rows(freetext.name)
              .map((n) => str(n.content))
              .join(", ") ||
            str(row(descriptive.dataSource).content) ||
            "Smithsonian Institution",
          license: "CC0 1.0",
          licenseUrl: licenseUrl("CC0 1.0"),
          sourcePage: str(descriptive.record_link),
          description: rows(freetext.notes)
            .map((n) => str(n.content))
            .join(" "),
          tags: rows(freetext.topic).map((n) => str(n.content)),
        });
      }
    }
  return candidates;
}
export function rankImages(
  candidates: readonly ImageCandidate[],
  concept: string,
  subject: string,
  policy: MediaLicensePolicy = { allowNonCommercial: true, allowUnknownLicense: false },
): ImageCandidate[] {
  const terms = new Set(`${concept} ${subject}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      if (
        seen.has(c.url) ||
        !embeddableLicense(c.license, policy) ||
        /\b(?:logo|icon|banner|advertisement)\b/i.test(c.title)
      )
        return false;
      seen.add(c.url);
      return true;
    })
    .map((c) => {
      const words = `${c.title} ${c.description} ${c.tags.join(" ")}`.toLowerCase();
      const relevance = [...terms].filter((t) => words.includes(t)).length;
      const fit =
        (/history|art/.test(subject) && /met|smithsonian/.test(c.backend)) ||
        (/science|technology/.test(subject) && c.backend === "nasa");
      return {
        c,
        relevance,
        score:
          relevance * 10 +
          Number(fit) * 2 +
          (c.width !== undefined && c.width >= 800 ? 3 : 0) +
          (/CC0|public domain/.test(c.license ?? "") ? 2 : c.license?.includes("-NC") ? 0 : 1),
      };
    })
    .filter((c) => c.relevance > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.c);
}
async function json(url: URL | string, signal?: AbortSignal, token?: string): Promise<unknown> {
  const result = await safeFetch(String(url), {
    maxBytes: 2 * 1024 * 1024,
    httpsOnly: true,
    signal,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  return JSON.parse(Buffer.from(result.bytes).toString("utf8"));
}
export async function searchImages(
  query: string,
  opts: { signal?: AbortSignal; env?: NodeJS.ProcessEnv; subject?: string } = {},
): Promise<{ candidates: ImageCandidate[]; warnings: string[] }> {
  const env = opts.env ?? process.env,
    candidates: ImageCandidate[] = [],
    warnings: string[] = [];
  const run = async (backend: ImageBackend, task: () => Promise<ImageCandidate[]>) => {
    opts.signal?.throwIfAborted();
    try {
      candidates.push(...(await task()));
    } catch {
      opts.signal?.throwIfAborted();
      warnings.push(`${backend}: image search unavailable`);
    }
  };
  // Bounded requests, no automatic retries. Each backend can fail independently.
  await run("commons", async () => {
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    for (const [k, v] of Object.entries({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiurlwidth: "1200",
    }))
      u.searchParams.set(k, v);
    return normalizeImageResults(await json(u, opts.signal), "commons");
  });
  await run("openverse", async () => {
    const u = new URL("https://api.openverse.org/v1/images/");
    u.searchParams.set("q", query);
    u.searchParams.set("page_size", "8");
    return normalizeImageResults(await json(u, opts.signal, env.OPENVERSE_ACCESS_TOKEN), "openverse");
  });
  if (/history|art|general/.test(opts.subject ?? "general"))
    await run("met", async () => {
      const u = new URL("https://collectionapi.metmuseum.org/public/collection/v1/search");
      u.searchParams.set("q", query);
      u.searchParams.set("hasImages", "true");
      const d = row(await json(u, opts.signal));
      const found: ImageCandidate[] = [];
      for (const id of (Array.isArray(d.objectIDs) ? d.objectIDs : []).slice(0, 3))
        if (typeof id === "number")
          found.push(
            ...normalizeImageResults(
              await json(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, opts.signal),
              "met",
            ),
          );
      return found;
    });
  if (/science|technology|general/.test(opts.subject ?? "general"))
    await run("nasa", async () => {
      const u = new URL("https://images-api.nasa.gov/search");
      u.searchParams.set("q", query);
      u.searchParams.set("media_type", "image");
      u.searchParams.set("page_size", "8");
      const found = normalizeImageResults(await json(u, opts.signal), "nasa");
      for (const image of found.slice(0, 3)) {
        const id = image.sourcePage.split("/").at(-1);
        const assets = rows(
          row(row(await json(`https://images-api.nasa.gov/asset/${id}`, opts.signal)).collection).items,
        );
        const medium = assets.map((a) => str(a.href)).find((u) => /~medium\.(?:jpg|png)$/i.test(u));
        if (medium) image.url = medium;
      }
      return found;
    });
  if (env.SMITHSONIAN_API_KEY)
    await run("smithsonian", async () => {
      const u = new URL("https://api.si.edu/openaccess/api/v1.0/search");
      u.searchParams.set("api_key", env.SMITHSONIAN_API_KEY ?? "");
      u.searchParams.set("q", query);
      u.searchParams.set("rows", "8");
      return normalizeImageResults(await json(u, opts.signal), "smithsonian");
    });
  return { candidates, warnings };
}
/** Exa imageLinks are discovery only: require explicit permission from their fetched page. */
export async function exaImageCandidates(
  pages: readonly SearchResult[],
  signal?: AbortSignal,
): Promise<ImageCandidate[]> {
  const candidates: ImageCandidate[] = [];
  for (const page of pages.filter((p) => (p.quality ?? 0) >= 60 && p.images?.length).slice(0, 3)) {
    try {
      const result = await safeFetch(page.url, { maxBytes: 2 * 1024 * 1024, httpsOnly: true, signal });
      const extracted = htmlToMarkdown(Buffer.from(result.bytes).toString("utf8"), result.url);
      for (const image of extracted.images.filter((i) => page.images?.some((p) => p.url === i.url)))
        candidates.push({
          url: image.url,
          thumbnail: image.url,
          title: image.caption || image.alt,
          creator: image.creator || extracted.byline || page.title,
          license: image.license,
          licenseUrl: image.licenseUrl,
          sourcePage: page.url,
          description: image.nearHeading,
          tags: [],
          backend: "exa",
        });
    } catch {
      signal?.throwIfAborted();
    }
  }
  return candidates;
}
