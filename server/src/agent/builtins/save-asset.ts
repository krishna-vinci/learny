import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@studium/shared";
import { Type } from "typebox";
import { commonsMetadata, readSourceFigures } from "../../ingest/figures.js";
import { embeddableLicense, licenseLabel, licenseUrl, mediaLicensePolicy } from "../../ingest/image-license.js";
import { assertPublicUrl, safeFetch } from "../../ingest/safe-fetch.js";
import type { FileLocks } from "../../tree/lock.js";
import { assetBytes, SET_ASSETS_QUOTA_BYTES } from "../../tree/media.js";
import { chosenBriefImage } from "../../tree/media-brief.js";
import { canonicalRel, resolveInRoot } from "../../tree/paths.js";

export { MAX_IMAGE_BYTES, sniffImage } from "../../ingest/image-bytes.js";

import { MAX_IMAGE_BYTES, sniffImage } from "../../ingest/image-bytes.js";

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
      "Copy a captured source figure or save a public HTTPS raster image locally with its credit. Returns the path and exact Markdown to paste into a note.",
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
        let pageUrl: string | undefined;
        let figure: Awaited<ReturnType<typeof readSourceFigures>>[number] | undefined;
        if (params.sourceId) {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(params.sourceId)) throw new Error("Invalid sourceId");
          const source = await fs.readFile(resolveInRoot(opts.root, `library/${params.sourceId}/source.md`), "utf8");
          const value = parseFrontmatter(source).frontmatter.url;
          if (typeof value === "string") pageUrl = value;
          figure = (await readSourceFigures(opts.root, params.sourceId)).find((f) => f.url === params.url);
        }
        const chosen = await chosenBriefImage(opts.root, opts.set, params.url);
        const commons =
          !figure?.license && !chosen?.license
            ? await commonsMetadata(params.url, signal).catch(() => undefined)
            : undefined;
        if (
          /-ND/i.test(figure?.license ?? chosen?.license ?? commons?.license ?? "") &&
          /\/thumb\//.test(new URL(params.url).pathname)
        )
          throw new Error("ND images require the original file URL, not a derivative thumbnail");
        const license = figure?.license ?? chosen?.license ?? commons?.license;
        const creator = (
          figure?.creator ||
          chosen?.creator ||
          commons?.creator ||
          figure?.credit.split(", ")[0]
        )?.replace(/["\\\r\n]/g, " ");
        const sourcePage = figure?.sourcePage || chosen?.sourcePage || commons?.sourcePage || pageUrl;
        const reuseAllowed = embeddableLicense(license, await mediaLicensePolicy(opts.root));
        signal?.throwIfAborted();
        let captured: Uint8Array | undefined;
        if (figure?.path && params.sourceId) {
          const local = `library/${params.sourceId}/${figure.path}`;
          if (canonicalRel(opts.root, local) !== local)
            throw new Error("Captured figure paths may not be symlink aliases");
          const handle = await fs.open(resolveInRoot(opts.root, local), constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error("Captured figure exceeds image limits");
            captured = new Uint8Array(await handle.readFile());
          } finally {
            await handle.close();
          }
        }
        if (!captured) await assertPublicUrl(params.url);
        const response = captured
          ? { bytes: captured, url: params.url, contentType: sniffImage(captured).mime }
          : await safeFetch(params.url, {
              maxBytes: MAX_IMAGE_BYTES,
              httpsOnly: true,
              ...(signal ? { signal } : {}),
            });
        if (new URL(response.url).protocol !== "https:") throw new Error("Images require HTTPS, including redirects");
        if (response.bytes.length > MAX_IMAGE_BYTES)
          throw new Error(`Image exceeds ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
        const image = sniffImage(response.bytes);
        if (response.contentType?.split(";")[0]?.trim().toLowerCase() !== image.mime)
          throw new Error("Image MIME type does not match its magic bytes");
        if (image.width < 1 || image.height < 1 || image.width > 6000 || image.height > 6000)
          throw new Error("Image dimensions must be at most 6000×6000 px");
        const base = `${opts.set}/assets`;
        return await opts.locks.withLock(base, opts.holder, async () => {
          if ((await assetBytes(opts.root, opts.set)) + response.bytes.length > SET_ASSETS_QUOTA_BYTES)
            throw new Error("Set assets quota exceeded");
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
          // Unknown or unstated licences still get an honest visible label; the source link is required.
          const visibleCredit = sourcePage
            ? `Credit: ${[creator, licenseLabel(license), sourcePage].filter(Boolean).join(", ")}`.replace(
                /["\\\r\n]/g,
                " ",
              )
            : undefined;
          const credit = JSON.stringify(
            {
              url: params.url,
              ...(pageUrl ? { pageUrl } : {}),
              ...(params.sourceId ? { sourceId: params.sourceId } : {}),
              alt: params.alt,
              ...(license ? { license } : {}),
              licenseLabel: licenseLabel(license),
              ...(creator ? { creator } : {}),
              ...(sourcePage ? { sourcePage } : {}),
              ...(figure?.licenseUrl || chosen?.licenseUrl || commons?.licenseUrl || licenseUrl(license)
                ? { licenseUrl: figure?.licenseUrl || chosen?.licenseUrl || commons?.licenseUrl || licenseUrl(license) }
                : {}),
              ...(visibleCredit ? { credit: visibleCredit } : {}),
              sha256: createHash("sha256").update(response.bytes).digest("hex"),
              unmodified: true,
              width: image.width,
              height: image.height,
              savedAt: new Date().toISOString(),
            },
            null,
            2,
          );
          if (
            (await assetBytes(opts.root, opts.set)) + response.bytes.length + Buffer.byteLength(credit) >
            SET_ASSETS_QUOTA_BYTES
          )
            throw new Error("Set assets quota exceeded");
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
          const markdown = `![${alt}](../${relative}${visibleCredit ? ` "${visibleCredit}"` : ""})`;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  path: relative,
                  markdown,
                  ...(!reuseAllowed
                    ? {
                        warning:
                          "Source figure's licence is excluded by the current media policy; redraw and cite it instead of embedding.",
                      }
                    : {}),
                  ...(visibleCredit ? { credit: visibleCredit } : {}),
                }),
              },
            ],
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
