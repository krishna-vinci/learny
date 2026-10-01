import { promises as fs } from "node:fs";
import { mediaAttributes, resolveNoteMedia, youtubeDirective, youtubeVideoId } from "@studium/shared/media";
import { listSources } from "../ingest/library.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";

/** A missing figure is advisory; a valid note write must still succeed. */
export async function mediaWarnings(root: string, notePath: string, text: string): Promise<string[]> {
  if (!/^[^/]+\/notes\/.+\.md$/.test(notePath)) return [];
  const warnings: string[] = [];
  let sources: Awaited<ReturnType<typeof listSources>> | undefined;
  async function exists(src: string, kind: "image" | "html" | "poster" = "image") {
    const media = resolveNoteMedia(notePath, src, kind);
    try {
      if (!media) throw new Error("invalid path");
      const rel = `${media.set}/${media.path}`;
      const canonical = canonicalRel(root, rel);
      if (!canonical.startsWith(`${media.set}/assets/`) && !canonical.startsWith(`${media.set}/artifacts/`))
        throw new Error("outside media folders");
      if (!(await fs.stat(resolveInRoot(root, rel))).isFile()) throw new Error("not a file");
    } catch {
      warnings.push(`Media path is missing or unavailable: ${src}`);
    }
  }
  const definitions = new Map<string, string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]^]+)\]:\s*<?([^\s>]+)>?/gm))
    definitions.set((match[1] ?? "").toLowerCase(), match[2] ?? "");
  let fence = "";
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker?.[1]) {
      fence = fence ? "" : marker[1];
      continue;
    }
    if (fence) continue;
    for (const match of line.matchAll(/!\[([^\]]*)\](?:\(<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\)|\[([^\]]*)\])?/g)) {
      const src = match[2] ?? definitions.get((match[3] || match[1] || "").toLowerCase());
      if (src && !src.startsWith("https:")) await exists(src);
    }
    const match = /^::(youtube|artifact)\{(.*)\}$/.exec(line);
    if (!match) continue;
    const attrs = mediaAttributes(match[2] ?? "");
    if (match[1] === "youtube") {
      const video = attrs ? youtubeDirective(attrs) : null;
      sources ??= await listSources(root);
      if (!video || !sources.some((s) => s.type === "video" && s.url && youtubeVideoId(s.url) === video.id))
        warnings.push(
          `YouTube video is not a library source: ${attrs?.src ?? "invalid directive"}. Add and ingest the video first.`,
        );
    } else if (attrs?.src) {
      await exists(attrs.src, "html");
      if (attrs.poster) await exists(attrs.poster, "poster");
    }
  }
  return [...new Set(warnings)];
}
