import { decodeBody, safeFetch } from "./safe-fetch.js";

export interface MineruOptions {
  mineruUrl: string;
  filename?: string;
  signal?: AbortSignal;
}

export class MineruError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MineruError";
  }
}

const MINERU_TIMEOUT_MS = 30 * 60 * 1000;
const MINERU_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Parse a document with a MinerU service (`POST /file_parse`) and return its
 * markdown. Synchronous endpoint, so it gets a long timeout.
 */
export async function mineruParse(bytes: Uint8Array, options: MineruOptions): Promise<string> {
  const base = options.mineruUrl.replace(/\/+$/, "");
  const form = new FormData();
  // slice() returns a Uint8Array backed by a plain ArrayBuffer, which BlobPart requires.
  form.append("file", new Blob([bytes.slice()]), options.filename ?? "document.pdf");
  form.append("parse_method", "auto");
  form.append("return_content_list", "true");

  const response = await safeFetch(`${base}/file_parse`, {
    method: "POST",
    body: form,
    signal: options.signal,
    timeoutMs: MINERU_TIMEOUT_MS,
    maxBytes: MINERU_MAX_BYTES,
  });

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBody(response.bytes, response.contentType));
  } catch (cause) {
    throw new MineruError("MinerU returned invalid JSON", { cause });
  }

  const markdown = extractMineruMarkdown(payload);
  if (markdown === null) throw new MineruError("MinerU response contained no markdown");
  return markdown;
}

function extractMineruMarkdown(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const root = payload as Record<string, unknown>;
  const direct = root.md_content ?? root.markdown;
  if (typeof direct === "string" && direct.trim() !== "") return direct;

  const results = root.results ?? root.data;
  if (typeof results === "object" && results !== null) {
    for (const value of Object.values(results as Record<string, unknown>)) {
      if (typeof value === "object" && value !== null) {
        const entry = value as Record<string, unknown>;
        const candidate = entry.md_content ?? entry.markdown;
        if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
      }
    }
  }
  return null;
}
