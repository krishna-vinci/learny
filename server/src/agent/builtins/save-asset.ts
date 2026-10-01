import { promises as fs } from "node:fs";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@studium/shared";
import { Type } from "typebox";
import { assertPublicUrl, safeFetch } from "../../ingest/safe-fetch.js";
import type { FileLocks } from "../../tree/lock.js";
import { assetBytes } from "../../tree/media.js";
import { canonicalRel, resolveInRoot } from "../../tree/paths.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Only header bytes are read; malformed/truncated headers fail closed. */
export function sniffImage(bytes: Uint8Array): { ext: string; mime: string; width: number; height: number } {
  const b = Buffer.from(bytes);
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString("ascii", 12, 16) === "IHDR"
  )
    return { ext: "png", mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6)))
    return { ext: "gif", mime: "image/gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return { ext: "webp", mime: "image/webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    if (kind === "VP8 " && b.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
      return { ext: "webp", mime: "image/webp", width: b.readUInt16LE(26) & 16383, height: b.readUInt16LE(28) & 16383 };
    if (kind === "VP8L" && b[20] === 47) {
      const bits = b.readUInt32LE(21);
      return { ext: "webp", mime: "image/webp", width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
    }
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset] !== 255) break;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker !== undefined && marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > b.length) break;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) break;
      if (
        marker !== undefined &&
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      )
        return {
          ext: "jpg",
          mime: "image/jpeg",
          width: b.readUInt16BE(offset + 5),
          height: b.readUInt16BE(offset + 3),
        };
      offset += length;
    }
  }
  throw new Error("Only PNG, JPEG, GIF and WebP images with valid headers can be saved (SVG downloads are forbidden)");
}

export function saveAssetTool(opts: {
  root: string;
  set: string;
  locks: FileLocks;
  holder: string;
  canWrite: (rel: string) => boolean;
  onWrite?: (rel: string) => void;
}): ToolDefinition {
  return defineTool({
    name: "save_asset",
    label: "Save an image",
    description:
      "Save a public HTTPS raster image locally with its credit. Returns the path and exact Markdown to paste into a note.",
    parameters: Type.Object({
      set: Type.String(),
      url: Type.String(),
      name: Type.String(),
      alt: Type.String(),
      sourceId: Type.Optional(Type.String()),
    }),
    executionMode: "sequential" as const,
    async execute(_id, params, signal) {
      try {
        if (params.set !== opts.set) throw new Error("Image is outside this role's study set");
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(params.name))
          throw new Error("name must be a lowercase kebab-case basename without an extension");
        if (new URL(params.url).protocol !== "https:") throw new Error("Images require HTTPS");
        await assertPublicUrl(params.url);
        const response = await safeFetch(params.url, {
          maxBytes: MAX_IMAGE_BYTES,
          httpsOnly: true,
          ...(signal ? { signal } : {}),
        });
        if (new URL(response.url).protocol !== "https:") throw new Error("Images require HTTPS, including redirects");
        if (response.bytes.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5 MB");
        const image = sniffImage(response.bytes);
        if (response.contentType?.split(";")[0]?.trim().toLowerCase() !== image.mime)
          throw new Error("Image MIME type does not match its magic bytes");
        if (image.width < 1 || image.height < 1 || image.width > 6000 || image.height > 6000)
          throw new Error("Image dimensions must be at most 6000×6000 px");
        const base = `${opts.set}/assets`;
        let pageUrl: string | undefined;
        if (params.sourceId) {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(params.sourceId)) throw new Error("Invalid sourceId");
          const source = await fs.readFile(resolveInRoot(opts.root, `library/${params.sourceId}/source.md`), "utf8");
          const value = parseFrontmatter(source).frontmatter.url;
          if (typeof value === "string") pageUrl = value;
        }
        return await opts.locks.withLock(base, opts.holder, async () => {
          if ((await assetBytes(opts.root, opts.set)) + response.bytes.length > 50 * 1024 * 1024)
            throw new Error("Set assets quota exceeds 50 MB");
          let suffix = 1;
          let rel: string;
          let creditRel: string;
          while (true) {
            const name = `${params.name}${suffix === 1 ? "" : `-${suffix}`}`;
            rel = `${base}/${name}.${image.ext}`;
            creditRel = `${base}/${name}.json`;
            for (const candidate of [rel, creditRel]) {
              if (
                !opts.canWrite(candidate) ||
                !opts.canWrite(canonicalRel(opts.root, candidate)) ||
                !canonicalRel(opts.root, candidate).startsWith(`${base}/`)
              )
                throw new Error("Asset path is not writable by this role");
            }
            const exists = await Promise.all(
              [rel, creditRel].map(async (candidate) => {
                try {
                  await fs.lstat(resolveInRoot(opts.root, candidate));
                  return true;
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
                  throw error;
                }
              }),
            );
            if (!exists.some(Boolean)) break;
            suffix++;
          }
          const credit = JSON.stringify(
            {
              url: params.url,
              ...(pageUrl ? { pageUrl } : {}),
              ...(params.sourceId ? { sourceId: params.sourceId } : {}),
              alt: params.alt,
              savedAt: new Date().toISOString(),
            },
            null,
            2,
          );
          if (
            (await assetBytes(opts.root, opts.set)) + response.bytes.length + Buffer.byteLength(credit) >
            50 * 1024 * 1024
          )
            throw new Error("Set assets quota exceeds 50 MB");
          await fs.mkdir(resolveInRoot(opts.root, base), { recursive: true });
          await opts.locks.withLock(rel, opts.holder, async () => {
            await fs.writeFile(resolveInRoot(opts.root, rel), response.bytes, { flag: "wx" });
            try {
              await fs.writeFile(resolveInRoot(opts.root, creditRel), credit, { flag: "wx" });
            } catch (error) {
              await fs.unlink(resolveInRoot(opts.root, rel));
              throw error;
            }
          });
          opts.onWrite?.(rel);
          opts.onWrite?.(creditRel);
          const relative = rel.slice(opts.set.length + 1);
          const alt = params.alt.replace(/[\\[\]\r\n]/g, " ");
          const markdown = `![${alt}](../${relative})`;
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ path: relative, markdown }) }],
            details: { isError: false, path: relative, markdown } as {
              isError: boolean;
              path?: string;
              markdown?: string;
              summary?: string;
            },
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { isError: true, summary: message },
        };
      }
    },
  });
}
