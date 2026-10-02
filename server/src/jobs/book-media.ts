import { promises as fs } from "node:fs";
import path from "node:path";
import {
  chapterVisuals,
  formatMediaTime,
  mediaAttributes,
  resolveNoteMedia,
  youtubeDirective,
  youtubeVideoId,
} from "@studium/shared/media";
import { listSources } from "../ingest/library.js";
import { validateAgentMedia } from "../tree/media.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";

export function createBookMedia(root: string, temp: string) {
  let count = 0;
  let charts = 0;
  const copied = new Map<string, string>();
  let sources: ReturnType<typeof listSources> | undefined;
  async function youtube(line: string): Promise<string | null> {
    const match = /^::youtube\{(.*)\}$/.exec(line);
    if (!match) return null;
    const attrs = mediaAttributes(match[1] ?? "");
    const video = attrs ? youtubeDirective(attrs) : null;
    if (!video) return `(video unavailable: ${attrs?.src?.replace(/[<>]/g, "") ?? ""})`;
    sources ??= listSources(root);
    const source = (await sources).find((s) => s.type === "video" && s.url && youtubeVideoId(s.url) === video.id);
    const title = (attrs?.title || source?.title || attrs?.src || video.id).replace(/[[\]<>\n]/g, " ");
    const caption = `Video: ${title} at ${formatMediaTime(video.start)}`;
    let thumbnail = "";
    if (source) {
      try {
        const rel = `library/${source.id}/thumb.jpg`;
        if (canonicalRel(root, rel) === rel && (await fs.stat(resolveInRoot(root, rel))).size <= 5 * 1024 * 1024) {
          const target = `media/image-${++count}.jpg`;
          await fs.mkdir(path.join(temp, "media"), { recursive: true });
          await fs.copyFile(resolveInRoot(root, rel), path.join(temp, target));
          thumbnail = `![${caption}](${target})\n\n`;
        }
      } catch {
        /* Caption and link remain when the thumbnail is missing. */
      }
    }
    const link = `https://www.youtube.com/watch?v=${video.id}&t=${video.start}s`;
    return `${thumbnail}${caption}\n\n[Watch on YouTube](${link})`;
  }
  async function copyImage(notePath: string, src: string): Promise<string | null> {
    const media = resolveNoteMedia(notePath, src);
    if (!media) return null;
    try {
      const rel = `${media.set}/${media.path}`;
      const canonical = canonicalRel(root, rel);
      if (!canonical.startsWith(`${media.set}/assets/`) && !canonical.startsWith(`${media.set}/artifacts/`))
        return null;
      if (copied.has(canonical)) return copied.get(canonical) ?? null;
      const abs = resolveInRoot(root, rel);
      if ((await fs.stat(abs)).size > 10 * 1024 * 1024) return null;
      const bytes = await fs.readFile(abs);
      if (src.toLowerCase().endsWith(".svg")) validateAgentMedia(rel, bytes.toString("utf8"));
      const target = `media/image-${++count}${path.extname(src).toLowerCase()}`;
      await fs.mkdir(path.join(temp, "media"), { recursive: true });
      await fs.writeFile(path.join(temp, target), bytes);
      copied.set(canonical, target);
      return target;
    } catch {
      return null;
    }
  }
  return async (body: string, notePath: string): Promise<string> => {
    const chapter = chapterVisuals(body, notePath);
    // Leave fenced examples intact. Reference-style images share the same path resolution.
    let fence = "";
    let length = 0;
    const definitions = new Map<string, string>();
    for (const match of chapter.body.matchAll(/^ {0,3}\[([^\]^]+)\]:\s*<?([^\s>]+)>?/gm))
      definitions.set(match[1]?.toLowerCase() ?? "", match[2] ?? "");
    const lines: string[] = [];
    const sourceLines = chapter.body.split("\n");
    for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
      const line = sourceLines[lineIndex] ?? "";
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (marker?.[1]?.[0] === fence && marker[1].length >= length && !marker[2]?.trim()) fence = "";
        lines.push(line);
        continue;
      }
      if (marker?.[1] && marker[2]?.trim() === "vega-lite") {
        const end = sourceLines.findIndex(
          (candidate, index) =>
            index > lineIndex && new RegExp(`^ {0,3}${marker[1]?.[0]}{${marker[1]?.length},}\\s*$`).test(candidate),
        );
        if (end !== -1) {
          try {
            const { chartToSvg } = await import("./vega.js");
            const svg = await chartToSvg(sourceLines.slice(lineIndex + 1, end).join("\n"));
            const target = `media/chart-${++charts}.svg`;
            await fs.mkdir(path.join(temp, "media"), { recursive: true });
            await fs.writeFile(path.join(temp, target), svg);
            lines.push(`![Data chart](${target})`);
            lineIndex = end;
            continue;
          } catch {
            /* Keep the fenced spec if it cannot be safely rendered. */
          }
        }
      }
      if (marker?.[1]) {
        fence = marker[1][0] ?? "";
        length = marker[1].length;
        lines.push(line);
        continue;
      }
      const video = await youtube(line);
      if (video !== null) {
        lines.push(video);
        continue;
      }
      let updated = "";
      let offset = 0;
      for (const match of line.matchAll(/!\[([^\]]*)\](?:\(<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\)|\[([^\]]*)\])?/g)) {
        const alt = match[1] ?? "";
        const src = match[2] ?? definitions.get((match[3] || alt).toLowerCase()) ?? "";
        if (!src) continue;
        const target = await copyImage(notePath, src);
        updated += line.slice(offset, match.index) + (target ? `![${alt}](${target})` : `![${alt}](${src})`);
        offset = match.index + match[0].length;
      }
      lines.push(updated + line.slice(offset));
    }
    if (chapter.visuals.length) {
      lines.push("", "## Visuals in Studium", "");
      for (const visual of chapter.visuals) {
        const title = visual.title.replace(/[[\]<>\n*_`\\]/g, " ");
        const caption = visual.src
          ? `Interactive: ${title} — open this chapter's Visuals tab in Studium`
          : `Interactive: ${title} (unavailable)`;
        // The compiler copies only the static poster, never reads or runs the HTML.
        const target = visual.poster
          ? await copyImage(notePath, path.posix.relative(path.posix.dirname(notePath), visual.poster))
          : null;
        lines.push(target ? `![${caption}](${target})` : caption, "");
      }
    }
    return lines.join("\n");
  };
}
