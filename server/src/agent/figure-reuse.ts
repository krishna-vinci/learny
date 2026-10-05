import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readSourceFigures, reusableLicense } from "../ingest/figures.js";
import { listSources } from "../ingest/library.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";

/** Advisory at write time, mandatory at checking: unknown/restrictive figures must be redrawn. */
export async function figureReuseWarnings(root: string, notePath: string, text: string): Promise<string[]> {
  if (!/^[^/]+\/notes\/.+\.md$/.test(notePath)) return [];
  const images: { src: string; caption: string }[] = [];
  let fence = "";
  const definitions = new Map<string, string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]^]+)\]:\s*<?([^\s>]+)>?/gm))
    definitions.set((match[1] ?? "").toLowerCase(), match[2] ?? "");
  const lines = text.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  for (const [i, line] of lines.entries()) {
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
      if (src) images.push({ src, caption: lines.slice(i, i + 5).join("\n") });
    }
  }
  if (!images.length) return [];
  const figures = (
    await Promise.all(
      (
        await listSources(root)
      ).map(async (source) =>
        (await readSourceFigures(root, source.id)).map((figure) => ({ ...figure, sourceId: source.id })),
      ),
    )
  ).flat();
  const warnings: string[] = [];
  for (const image of images) {
    let figure = figures.find((f) => f.url === image.src);
    if (!figure && !/^https?:/.test(image.src)) {
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(notePath), image.src));
      if (rel.startsWith("../")) continue;
      const direct = figures.find((f) => f.path && `library/${f.sourceId}/${f.path}` === rel);
      if (direct) figure = direct;
      else if (/^library\/lib-[a-z0-9-]+\/figures\//.test(rel)) {
        warnings.push(
          `Source figure reuse: ${image.src} has no verified license metadata; redraw and cite its source.`,
        );
        continue;
      } else if (rel.startsWith(`${notePath.split("/")[0]}/assets/`)) {
        if (canonicalRel(root, rel) !== rel) {
          warnings.push(`Source figure reuse: aliased image ${image.src} is not permitted.`);
          continue;
        }
        let credit: { url?: string; sourceId?: string } | null = null;
        try {
          credit = JSON.parse(await fs.readFile(resolveInRoot(root, rel.replace(/\.[^.]+$/, ".json")), "utf8"));
        } catch {
          /* A broken sidecar never grants permission; compare captured bytes below. */
        }
        const bytes = await fs.readFile(resolveInRoot(root, rel)).catch(() => null);
        if (bytes) {
          const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
          figure = figures.find((f) => f.path?.includes(hash));
        }
        figure ??= figures.find((f) => f.url === credit?.url);
        if (!figure && credit?.sourceId) {
          warnings.push(
            `Source figure reuse: ${image.src} has no verified license metadata; redraw and cite ${credit.sourceId}.`,
          );
          continue;
        }
      }
    }
    if (!figure) continue;
    if (!reusableLicense(figure.license))
      warnings.push(
        `Source figure reuse: ${image.src} has no permissive license (${figure.license ?? "unknown"}); redraw and cite ${figure.sourceId}.`,
      );
    else if (
      !image.caption.includes(figure.license ?? "") ||
      !image.caption.includes(`[^src:${figure.sourceId}`) ||
      !image.caption.includes(figure.credit.split(", ")[0] ?? figure.credit)
    )
      warnings.push(`Source figure reuse: ${image.src} needs ${figure.credit} and a source citation in its caption.`);
  }
  return [...new Set(warnings)];
}
