export { assetUrl, mediaAttributes, resolveNoteMedia } from "./media-paths.js";

export interface YouTubeVideo {
  id: string;
  start: number;
  end?: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

function youtubeUrl(value: string): URL | null {
  const raw = value.trim();
  // URL() silently repairs backslashes and control characters. Do not repair junk.
  if (!raw || /[\\\s]/.test(raw) || [...raw].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    return null;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : /^[\w.-]+\//.test(raw) ? `https://${raw}` : raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    return YOUTUBE_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Seconds or YouTube's 1h2m3s form. Never pass untrusted strings to the player. */
function youtubeTime(value: string | null): number | undefined {
  if (!value) return undefined;
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : units
      ? Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
      : NaN;
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Only known video paths on known hosts; tracking/playlist parameters are irrelevant. */
export function parseYoutubeVideo(value: string, options: { allowId?: boolean } = {}): YouTubeVideo | null {
  if (options.allowId && VIDEO_ID.test(value.trim())) return { id: value.trim(), start: 0 };
  const url = youtubeUrl(value);
  if (!url) return null;
  let id: string | undefined | null;
  let pathId = true;
  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  } else if (/^\/watch\/?$/.test(url.pathname)) {
    if (url.searchParams.getAll("v").length !== 1) return null;
    id = url.searchParams.get("v");
    pathId = false;
  } else {
    id = /^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  }
  if (!id) return null;
  try {
    if (pathId) id = decodeURIComponent(id);
  } catch {
    return null;
  }
  if (!VIDEO_ID.test(id)) return null;
  if (url.hostname.endsWith("youtube-nocookie.com") && !url.pathname.startsWith("/embed/")) return null;
  const hash = new URLSearchParams(url.hash.slice(1));
  const start =
    youtubeTime(url.searchParams.get("t")) ??
    youtubeTime(url.searchParams.get("start")) ??
    youtubeTime(url.searchParams.get("time_continue")) ??
    youtubeTime(hash.get("t")) ??
    0;
  const end = youtubeTime(url.searchParams.get("end"));
  return { id, start, ...(end !== undefined && end > start ? { end } : {}) };
}

export function youtubeVideoId(value: string): string | null {
  return parseYoutubeVideo(value, { allowId: true })?.id ?? null;
}

export function youtubeDirective(attrs: Record<string, string | null | undefined>): YouTubeVideo | null {
  const video = typeof attrs.src === "string" ? parseYoutubeVideo(attrs.src, { allowId: true }) : null;
  const integer = (value: string | null | undefined) =>
    typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (
    !video ||
    (attrs.start !== undefined && !integer(attrs.start)) ||
    (attrs.end !== undefined && !integer(attrs.end))
  )
    return null;
  const start = attrs.start === undefined ? video.start : Number(attrs.start);
  const end = attrs.end === undefined ? video.end : Number(attrs.end);
  if (end !== undefined && end <= start) return null;
  return { id: video.id, start, ...(end === undefined ? {} : { end }) };
}

export function formatMediaTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export {
  type ChapterVisual,
  chapterVisuals,
  misplacedVisualDeclarations,
} from "./chapter-visuals.js";

/** Charts are local computations: every declared data source must be inline. */
export function parseInlineChart(json: string): Record<string, unknown> {
  const spec: unknown = JSON.parse(json);
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("Expected a Vega-Lite spec");
  let hasData = false;
  function check(value: unknown, key = ""): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) check(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (key === "data") {
      if (!Array.isArray(obj.values) || Object.keys(obj).some((k) => k !== "values"))
        throw new Error("Charts require inline data.values only");
      hasData = true;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (
        ["url", "href", "datasets"].includes(k) ||
        (k === "mark" &&
          (v === "image" || (v && typeof v === "object" && (v as Record<string, unknown>).type === "image")))
      )
        throw new Error("External chart resources are forbidden");
      check(v, k);
    }
  }
  check(spec);
  if (!hasData) throw new Error("Charts require inline data.values");
  return spec as Record<string, unknown>;
}
