import { mediaAttributes, resolveNoteMedia } from "./media-paths.js";

export interface ChapterVisual {
  title: string;
  /** Root-relative, already confined to this chapter's set; absent for invalid declarations. */
  src?: string;
  poster?: string;
  kind?: "widget" | "sketch";
}

/** Standalone leaf declarations are chapter attachments, not prose. Code examples stay code. */
export function chapterVisuals(body: string, notePath: string): { body: string; visuals: ChapterVisual[] } {
  const visuals: ChapterVisual[] = [];
  const seen = new Set<string>();
  let fence = "";
  let fenceLength = 0;
  const lines = body.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1]?.[0] === fence && marker[1].length >= fenceLength && !marker[2]?.trim()) fence = "";
      return line;
    }
    if (marker?.[1]) {
      fence = marker[1][0] ?? "";
      fenceLength = marker[1].length;
      return line;
    }
    const declaration = /^ {0,3}::(artifact|visual)\{(.*)\}\s*$/.exec(line);
    if (!declaration) return line;
    const attrs = mediaAttributes(declaration[2] ?? "");
    const media = attrs?.src
      ? resolveNoteMedia(notePath, attrs.src, declaration[1] === "visual" ? "visual" : "html")
      : null;
    const poster = attrs?.poster ? resolveNoteMedia(notePath, attrs.poster, "poster") : null;
    const src = media && (!attrs?.poster || poster) ? `${media.set}/${media.path}` : undefined;
    if (!src || !seen.has(src)) {
      visuals.push({
        title: attrs?.title?.trim().slice(0, 200) || "Interactive figure",
        ...(src ? { src } : {}),
        ...(declaration[1] === "visual"
          ? { kind: src?.endsWith(".json") ? ("widget" as const) : ("sketch" as const) }
          : {}),
        ...(src && poster ? { poster: `${poster.set}/${poster.path}` } : {}),
      });
      if (src) seen.add(src);
    }
    return "";
  });
  return { body: lines.join("\n"), visuals };
}
