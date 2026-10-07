import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import JSZip from "jszip";
import { sniffImage } from "./image-bytes.js";

export interface MineruOptions {
  mineruUrl: string;
  filename?: string;
  pages?: number;
  apiKey?: string;
  tier?: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onWarning?: (message: string) => void;
  /** Short deadlines in fake tests; production derives its deadline from pages. */
  timeoutMs?: number;
}

export class MineruError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MineruError";
  }
}

const MAX_BYTES = 64 * 1024 * 1024;
const TERMINAL = new Set(["completed", "partial", "failed", "canceled"]);

export function mineruTimeoutMs(pages = 0): number {
  return Math.min(3 * 60 * 60 * 1000, Math.max(10 * 60 * 1000, pages * 30_000));
}

/** This exception belongs only to MinerU: no redirects or other origins, even public ones. */
export function mineruEndpoint(base: string, endpoint: string): URL {
  const configured = new URL(base);
  const target = new URL(endpoint, `${configured.href.replace(/\/+$/, "")}/`);
  if (
    !["http:", "https:"].includes(configured.protocol) ||
    configured.username ||
    configured.password ||
    target.username ||
    target.password ||
    target.origin !== configured.origin
  )
    throw new MineruError("MinerU URL must stay on the configured HTTP(S) origin without credentials");
  return target;
}

/** Bounded service fetch; never passes its private-origin exception to safeFetch. */
async function serviceFetch(
  base: string,
  endpoint: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; text: string; bytes: Buffer }> {
  const response = await fetchImpl(mineruEndpoint(base, endpoint), { ...init, redirect: "error" });
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES) {
    await response.body?.cancel();
    throw new MineruError("MinerU response is too large");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      for (;;) {
        init.signal?.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BYTES) throw new MineruError("MinerU response is too large");
        chunks.push(chunk.value);
      }
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  return { status: response.status, text: bytes.toString("utf8"), bytes };
}

function json(text: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    /* Convert protocol errors to an actionable integration error. */
  }
  throw new MineruError("MinerU returned invalid JSON");
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value))
    throw new MineruError("MinerU returned an invalid ID");
  return value;
}
function auth(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export async function mineruHealth(
  options: Pick<MineruOptions, "mineruUrl" | "apiKey" | "tier">,
  fetchImpl: typeof fetch = fetch,
): Promise<{ reachable: boolean; version?: string; tier: string; detail: string }> {
  const tier = options.tier ?? "basic";
  try {
    const response = await serviceFetch(
      options.mineruUrl,
      "/v1/health",
      {
        headers: auth(options.apiKey),
        signal: AbortSignal.timeout(5000),
      },
      fetchImpl,
    );
    if (response.status !== 200) return { reachable: false, tier, detail: `HTTP ${response.status} · tier ${tier}` };
    const health = json(response.text);
    const version = typeof health.version === "string" ? health.version : "unknown";
    const reachable = health.status === "ok";
    return {
      reachable,
      version,
      tier,
      detail: `${reachable ? "reachable" : "unavailable"} · version ${version} · tier ${tier}`,
    };
  } catch (error) {
    return {
      reachable: false,
      tier,
      detail: `${error instanceof Error ? error.message : "unreachable"} · tier ${tier}`,
    };
  }
}

/** MinerU 4: upload → complete → submit → poll → download. Legacy only on absent V1 health. */
export async function mineruParse(bytes: Uint8Array, options: MineruOptions): Promise<string> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new MineruError("MinerU timed out")),
    options.timeoutMs ?? mineruTimeoutMs(options.pages),
  );
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  const base = options.mineruUrl;
  const headers = auth(options.apiKey ?? process.env.MINERU_API_KEY);
  let jobId: string | undefined;
  const request = async (endpoint: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    return serviceFetch(base, endpoint, { ...init, headers: { ...headers, ...init.headers }, signal });
  };
  const requestJson = async (endpoint: string, body?: unknown) => {
    const response = await request(
      endpoint,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (response.status < 200 || response.status >= 300) throw new MineruError(`MinerU HTTP ${response.status}`);
    return json(response.text);
  };
  try {
    options.onProgress?.("Parsing PDF with MinerU: waiting (checking service)");
    const health = await request("/v1/health");
    if ([404, 405].includes(health.status)) {
      const form = new FormData();
      form.append("file", new Blob([bytes.slice()]), options.filename ?? "document.pdf");
      form.append("parse_method", "auto");
      form.append("return_content_list", "true");
      const result = await request("/file_parse", { method: "POST", body: form });
      if (result.status < 200 || result.status >= 300) throw new MineruError(`MinerU HTTP ${result.status}`);
      const markdown = extractMineruMarkdown(json(result.text));
      if (markdown === null) throw new MineruError("MinerU response contained no markdown");
      return markdown;
    }
    if (health.status !== 200) throw new MineruError(`MinerU health HTTP ${health.status}`);
    json(health.text);
    options.onProgress?.("Parsing PDF with MinerU: waiting (uploading)");
    let upload = await requestJson("/v1/uploads", {
      filename: options.filename ?? "document.pdf",
      bytes: bytes.length,
      mime_type: "application/pdf",
      purpose: "parse",
      sha256sum: createHash("sha256").update(bytes).digest("hex"),
    });
    if (upload.status !== "completed") {
      const uploadId = id(upload.id);
      if (typeof upload.upload_url !== "string") throw new MineruError("MinerU returned no upload URL");
      const uploadHeaders = record(upload.upload_headers);
      if (Object.values(uploadHeaders).some((value) => typeof value !== "string"))
        throw new MineruError("Invalid upload headers");
      const result = await request(upload.upload_url, {
        method: "PUT",
        headers: { ...(uploadHeaders as Record<string, string>), ...headers },
        body: new Blob([bytes.slice()]),
      });
      if (result.status < 200 || result.status >= 300) throw new MineruError(`MinerU upload HTTP ${result.status}`);
      upload = await requestJson(`/v1/uploads/${uploadId}/complete`, {});
    }
    const fileId = id(record(upload.file).id);
    let job = await requestJson("/v1/parse/jobs", {
      files: [{ source: { type: "file_id", file_id: fileId } }],
      tier: options.tier ?? process.env.MINERU_TIER ?? "basic",
      output_formats: ["markdown", "zip"],
    });
    jobId = id(job.job_id);
    let waitMs = 1000;
    while (!TERMINAL.has(String(job.status))) {
      options.onProgress?.(`Parsing PDF with MinerU: waiting (${job.status})`);
      await delay(waitMs, undefined, { signal });
      waitMs = Math.min(10_000, Math.ceil(waitMs * 1.5));
      job = await requestJson(`/v1/parse/jobs/${jobId}`);
    }
    if (job.status === "failed" || job.status === "canceled") throw new MineruError(`MinerU job ${job.status}`);
    const files = Array.isArray(job.files) ? job.files : [];
    const output = files
      .map((file) => record(record(file).output_files).markdown)
      .find((value) => record(value).file_id);
    if (!output) throw new MineruError(`MinerU ${job.status} job contained no markdown`);
    if (job.status === "partial") options.onWarning?.("MinerU returned a partial parse; some content may be missing.");
    options.onProgress?.(`Parsing PDF with MinerU: ${job.status} (downloading)`);
    const result = await request(`/v1/files/${id(record(output).file_id)}/content`);
    if (result.status !== 200) throw new MineruError(`MinerU download HTTP ${result.status}`);
    if (!result.text.trim()) throw new MineruError("MinerU response contained no markdown");
    let markdown = result.text;
    const zipRef = files.map((file) => record(record(file).output_files).zip).find((value) => record(value).file_id);
    if (zipRef) {
      const archiveResult = await request(`/v1/files/${id(record(zipRef).file_id)}/content`);
      if (archiveResult.status !== 200) throw new MineruError(`MinerU archive HTTP ${archiveResult.status}`);
      const archive = await JSZip.loadAsync(archiveResult.bytes);
      // JSZip exposes declared inflated sizes; reject bombs before any decompression.
      let inflated = 0;
      for (const file of Object.values(archive.files)) {
        const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
        inflated += size;
        if (inflated > MAX_BYTES) throw new MineruError("MinerU archive is too large");
      }
      const paths = new Set<string>();
      for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        const path = match[1] ?? match[2] ?? "";
        if (!path.startsWith("data:") && !/^[a-z]+:/i.test(path)) paths.add(path);
      }
      for (const path of paths) {
        if (!/^(?:images\/)?[a-zA-Z0-9_.-]+\.(?:jpe?g|png|gif|webp)$/i.test(path) || path.includes(".."))
          throw new MineruError("MinerU archive has an invalid image path");
        const file = archive.file(path) ?? archive.file(`images/${path}`);
        if (!file) throw new MineruError("MinerU archive is missing a figure");
        const image = await file.async("uint8array");
        const info = sniffImage(image);
        const uri = `data:${info.mime};base64,${Buffer.from(image).toString("base64")}`;
        markdown = markdown
          .split(`](${path})`)
          .join(`](${uri})`)
          .split(`src="${path}"`)
          .join(`src="${uri}"`)
          .split(`src='${path}'`)
          .join(`src='${uri}'`);
      }
    }
    return markdown;
  } catch (error) {
    if (signal.aborted && jobId) {
      // Best effort cancellation uses its own short signal; never follows server-supplied links.
      await serviceFetch(base, `/v1/parse/jobs/${jobId}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
    }
    options.signal?.throwIfAborted();
    if (timeout.signal.aborted) throw new MineruError("MinerU timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractMineruMarkdown(root: Record<string, unknown>): string | null {
  const direct = root.md_content ?? root.markdown;
  if (typeof direct === "string" && direct.trim()) return direct;
  for (const value of Object.values(record(root.results ?? root.data))) {
    const candidate = record(value).md_content ?? record(value).markdown;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}
