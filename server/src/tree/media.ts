import { type Dirent, promises as fs } from "node:fs";
import { canonicalRel, resolveInRoot } from "./paths.js";
import { lintVisualHtml, svgViewBoxProblem, validateWidgetJson } from "./visual-lint.js";
export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
export const MEDIA_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=3600",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
};

/** Validate the complete edited document, including content outside the replacement. */
export function validateAgentMedia(rel: string, content: string): void {
  if (!/^[^/]+\/(assets|artifacts|visuals)\//.test(rel)) return;
  const ext = rel.split(".").pop()?.toLowerCase();
  if (ext === "svg" || ext === "html" || (ext === "json" && /^[^/]+\/visuals\//.test(rel))) {
    if (Buffer.byteLength(content) > 300 * 1024) throw new Error("SVG, HTML and visual JSON must be at most 300 KB");
  }
  if (/^[^/]+\/visuals\//.test(rel)) {
    if (ext === "json") validateWidgetJson(content);
    else if (ext === "html") {
      const problems = lintVisualHtml(content).errors;
      if (problems.length) throw new Error(problems.join("\n"));
    } else if (ext !== "svg") throw new Error("Visuals must be JSON, HTML or SVG");
  }
  if (ext !== "svg") return;
  if (
    !/<svg\b/i.test(content) ||
    /<\s*(?:[\w-]+:)?(script|foreignObject)\b|\bon[\w-]+\s*=|<!DOCTYPE|<!ENTITY/i.test(content)
  ) {
    throw new Error("Unsafe SVG: scripts, foreignObject, event handlers and entities are forbidden");
  }
  // Entity escapes must not disguise an external reference; CSS references are checked too.
  for (const match of content.matchAll(/(?:\b(?:xlink:)?href\s*=\s*["']([^"']*)["']|url\(\s*["']?([^)'"\s]+))/gi)) {
    const ref = match[1] ?? match[2] ?? "";
    if ((!ref.startsWith("#") && !ref.startsWith("data:")) || ref.includes("&")) {
      throw new Error("Unsafe SVG: references must start with # or data:");
    }
  }
  if (/@import|\b(?:xlink:)?href\s*=\s*[^\s"']/i.test(content))
    throw new Error("Unsafe SVG: external references are forbidden");
  if (/^[^/]+\/visuals\//.test(rel)) {
    const problem = svgViewBoxProblem(content);
    if (problem) throw new Error(problem);
  }
}

export async function assetBytes(root: string, set: string): Promise<number> {
  let total = 0;
  async function walk(rel: string): Promise<void> {
    const canonical = canonicalRel(root, rel);
    if (canonical !== `${set}/assets` && !canonical.startsWith(`${set}/assets/`))
      throw new Error("Assets must stay inside this set's assets folder");
    let entries: Dirent[];
    try {
      entries = await fs.readdir(resolveInRoot(root, rel), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed in assets");
      if (entry.isDirectory()) await walk(child);
      else total += (await fs.stat(resolveInRoot(root, child))).size;
    }
  }
  await walk(`${set}/assets`);
  return total;
}

export async function validateMediaWrite(root: string, rel: string, content: string): Promise<void> {
  validateAgentMedia(rel, content);
  const [set, kind] = rel.split("/");
  if (!set || kind !== "assets") return;
  let previous = 0;
  try {
    previous = (await fs.stat(resolveInRoot(root, rel))).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if ((await assetBytes(root, set)) - previous + Buffer.byteLength(content) > 50 * 1024 * 1024)
    throw new Error("Set assets quota exceeds 50 MB");
}
