import { promises as fs } from "node:fs";
import { parseFrontmatter } from "@studium/shared";
import {
  mediaAttributes,
  parseYoutubeVideo,
  resolveNoteMedia,
  youtubeDirective,
  youtubeVideoId,
} from "@studium/shared/media";
import { parseSketchHeader } from "@studium/shared/visuals/sketch";
import { listSources } from "../ingest/library.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";
import { lintVisualHtml } from "../tree/visual-lint.js";

import { figureReuseWarnings } from "./figure-reuse.js";

/** A missing figure is advisory; a valid note write must still succeed. */
export async function mediaWarnings(root: string, notePath: string, text: string): Promise<string[]> {
  if (/^[^/]+\/visuals\/.+\.html$/.test(notePath)) {
    const warnings = lintVisualHtml(text).warnings;
    try {
      const header = parseSketchHeader(text);
      for (const poster of [header.poster, ...(header.posters ?? []).map((p) => p.src)]) {
        if (!poster) continue;
        try {
          const rel = `${notePath.slice(0, notePath.lastIndexOf("/"))}/${poster}`;
          const [set] = notePath.split("/");
          const canonical = canonicalRel(root, rel);
          if (!canonical.startsWith(`${set}/visuals/`) || !(await fs.stat(resolveInRoot(root, rel))).isFile())
            throw new Error("unavailable poster");
        } catch {
          warnings.push(
            `Poster ${poster}: write this static SVG in the same visuals folder before attaching the sketch.`,
          );
        }
      }
    } catch {
      // Invalid headers are already hard write errors, not advisory missing-file warnings.
    }
    return warnings;
  }
  if (!/^[^/]+\/notes\/.+\.md$/.test(notePath)) return [];
  const warnings: string[] = [];
  const { frontmatter, body } = parseFrontmatter(text);
  const linkedVideos = new Set<string>();
  let sources: Awaited<ReturnType<typeof listSources>> | undefined;
  async function exists(src: string, kind: "image" | "html" | "poster" | "visual" = "image") {
    const media = resolveNoteMedia(notePath, src, kind);
    try {
      if (!media) throw new Error("invalid path");
      const rel = `${media.set}/${media.path}`;
      const canonical = canonicalRel(root, rel);
      if (
        !canonical.startsWith(`${media.set}/assets/`) &&
        !canonical.startsWith(`${media.set}/artifacts/`) &&
        !canonical.startsWith(`${media.set}/visuals/`)
      )
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
  for (const line of body.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1] && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2]?.trim())
        fence = "";
      continue;
    }
    if (marker?.[1]) {
      fence = marker[1];
      continue;
    }
    for (const match of line.matchAll(/!\[([^\]]*)\](?:\(<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\)|\[([^\]]*)\])?/g)) {
      const src = match[2] ?? definitions.get((match[3] || match[1] || "").toLowerCase());
      if (src && !src.startsWith("https:")) await exists(src);
    }
    const linkLine = line.replace(/(`+).*?\1/g, "").replace(/<(?!(?:https?:)?\/\/)[^>]*>/gi, "");
    for (const url of linkLine.matchAll(
      /(?:https?:\/\/|\/\/)[^\s<>"')\]]+|(?:^|[\s(])(?:(?:www|m|music)\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s<>"')\]]+/gi,
    )) {
      const video = parseYoutubeVideo(
        url[0]
          .trim()
          .replace(/^\(/, "")
          .replace(/[.,!?:;]+$/, ""),
      );
      if (video) linkedVideos.add(video.id);
    }
    const match = /^::(youtube|artifact|visual)\{(.*)\}$/.exec(line);
    if (!match) continue;
    const attrs = mediaAttributes(match[2] ?? "");
    if (match[1] === "youtube") {
      const video = attrs ? youtubeDirective(attrs) : null;
      if (video) linkedVideos.add(video.id);
      sources ??= await listSources(root);
      if (!video || !sources.some((s) => s.type === "video" && s.url && youtubeVideoId(s.url) === video.id))
        warnings.push(
          `YouTube video is not a library source: ${attrs?.src ?? "invalid directive"}. Add and ingest the video first.`,
        );
    } else if (attrs?.src) {
      await exists(attrs.src, match[1] === "visual" ? "visual" : "html");
      if (attrs.poster) await exists(attrs.poster, "poster");
    }
  }
  const cited = frontmatter.sources;
  if (Array.isArray(cited) && cited.length) {
    sources ??= await listSources(root);
    for (const source of sources) {
      if (!cited.includes(source.id) || source.type !== "video" || !source.url) continue;
      const video = parseYoutubeVideo(source.url);
      if (video && !linkedVideos.has(video.id))
        warnings.push(
          `Video source ${source.id} needs a watch link near the concept it supports: https://www.youtube.com/watch?v=${video.id}. Use transcript timestamps when present; never invent them.`,
        );
    }
  }
  warnings.push(...(await figureReuseWarnings(root, notePath, text)));
  return [...new Set(warnings)];
}
