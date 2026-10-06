import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readSourceFigures, reusableLicense } from "../ingest/figures.js";
import { allowNonCommercial } from "../ingest/image-license.js";

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
    for (const match of line.matchAll(
      /!\[([^\]]*)\](?:\(<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\)|\[([^\]]*)\])?/g,
    )) {
      const src = match[2] ?? definitions.get((match[3] || match[1] || "").toLowerCase());
      if (src) images.push({ src, caption: lines.slice(i, i + 5).join("\n") });
    }
  }
  if (!images.length) return [];
  const allowNC = await allowNonCommercial(root);
  const figures = (
    await Promise.all((await listSources(root)).map((source) => readSourceFigures(root, source.id)))
  ).flat();
  const warnings: string[] = [];
  for (const image of images) {
    if (!/\.svg(?:[?#]|$)/i.test(image.src)) {
      if (/^https?:/i.test(image.src)) {
        warnings.push(`Source figure reuse: ${image.src} must be saved locally with a licensed credit sidecar.`);
        continue;
      }
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(notePath), image.src));
      const base = `${notePath.split("/")[0]}/assets/`;
      if (!rel.startsWith(base) || !/\.(?:png|jpe?g|gif|webp)$/i.test(rel) || canonicalRel(root, rel) !== rel) {
        warnings.push(`Source figure reuse: ${image.src} requires a confined local raster asset.`);
        continue;
      }
      const sidecar = rel.replace(/\.[^.]+$/, ".json");
      try {
        if (canonicalRel(root, sidecar) !== sidecar) throw new Error("aliased sidecar");
        const bytes = await fs.readFile(resolveInRoot(root, rel));
        const hash = createHash("sha256").update(bytes).digest("hex");
        const captured = figures.find((f) => f.path?.includes(hash.slice(0, 24)));
        if (captured && !reusableLicense(captured.license, allowNC))
          throw new Error(`unacceptable captured license (${captured.license ?? "unknown"})`);
        const meta = JSON.parse(await fs.readFile(resolveInRoot(root, sidecar), "utf8"));
        if (!reusableLicense(typeof meta.license === "string" ? meta.license : undefined, allowNC))
          throw new Error(`unacceptable license (${meta.license ?? "unknown"})`);
        const creator = typeof meta.creator === "string" ? meta.creator.trim() : "";
        const source = typeof meta.sourcePage === "string" ? meta.sourcePage : meta.pageUrl;
        if (
          !creator ||
          !source ||
          !image.caption.includes(creator) ||
          !image.caption.includes(meta.license) ||
          !image.caption.includes(source)
        )
          throw new Error("missing visible creator, license or source credit");
        if (/-ND/i.test(meta.license)) {
          const bytes = await fs.readFile(resolveInRoot(root, rel));
          if (meta.unmodified !== true || meta.sha256 !== createHash("sha256").update(bytes).digest("hex"))
            throw new Error("ND image must remain unmodified with its original saved hash");
        }
      } catch (error) {
        warnings.push(
          `Source figure reuse: ${image.src}: ${error instanceof Error ? error.message : "invalid credit sidecar"}; link or redraw instead.`,
        );
      }
    }
  }
  return [...new Set(warnings)];
}
