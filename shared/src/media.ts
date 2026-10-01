/** Resolve Markdown paths against a note, keeping media within its original set. */
export function resolveNoteMedia(
  notePath: string | undefined,
  src: string,
  kind: "image" | "html" | "poster" = "image",
): { set: string; path: string } | null {
  if (!notePath || /[\\\0?#]/.test(src) || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src)) return null;
  const set = notePath.split("/")[0];
  if (!set || set === "library" || !/^[a-z0-9][a-z0-9-]*$/.test(set)) return null;
  const segments = notePath.split("/").slice(0, -1);
  for (const part of src.split("/")) {
    if (part === "..") {
      if (segments.length <= 1) return null;
      segments.pop();
    } else if (part !== "." && part !== "") segments.push(part);
  }
  if (segments[0] !== set) return null;
  const rel = segments.slice(1).join("/");
  const pattern =
    kind === "html"
      ? /^artifacts\/.+\.html$/
      : kind === "poster"
        ? /^artifacts\/.+\.svg$/
        : /^(assets|artifacts)\/.+\.(png|jpe?g|gif|webp|svg)$/i;
  return pattern.test(rel) ? { set, path: rel } : null;
}

export function assetUrl(media: { set: string; path: string }): string {
  return `/api/sets/${encodeURIComponent(media.set)}/asset?path=${encodeURIComponent(media.path)}`;
}

export function youtubeVideoId(value: string): string | null {
  const valid = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") return valid(url.pathname.split("/")[1]);
    if (["youtube.com", "youtube-nocookie.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      if (url.pathname === "/watch") return valid(url.searchParams.get("v"));
      return valid(/^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/.exec(url.pathname)?.[1]);
    }
    return null;
  } catch {
    return valid(value.trim());
  }
}

export function youtubeDirective(
  attrs: Record<string, string | null | undefined>,
): { id: string; start: number; end?: number } | null {
  const id = typeof attrs.src === "string" ? youtubeVideoId(attrs.src) : null;
  const integer = (value: string | null | undefined) =>
    value !== null && value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (!id || (attrs.start !== undefined && !integer(attrs.start)) || (attrs.end !== undefined && !integer(attrs.end)))
    return null;
  return { id, start: Number(attrs.start ?? 0), ...(attrs.end === undefined ? {} : { end: Number(attrs.end) }) };
}

export function formatMediaTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Leaf attribute subset used by the book preprocessor and note-write warnings. */
export function mediaAttributes(text: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  let remainder = text;
  while (remainder.trim()) {
    const match = /^\s*([\w-]+)=(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'{}]+))\s*/.exec(remainder);
    if (!match?.[1] || match[1] in attrs) return null;
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
    remainder = remainder.slice(match[0].length);
  }
  return attrs;
}

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
