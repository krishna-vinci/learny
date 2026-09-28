import { lookup as lookupHost } from "node:dns/promises";
import net from "node:net";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 200 * 1024;
const MAX_REDIRECTS = 5;

interface ToolDetails {
  isError: boolean;
  summary: string;
}

export interface WebFetchOptions {
  firecrawlUrl?: string;
  firecrawlKey?: string;
}

function result(summary: string, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { isError: false as boolean, summary } satisfies ToolDetails,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true as boolean, summary: message } satisfies ToolDetails,
  };
}

function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 240
  );
}

function isPrivateIPv6(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase().split("%")[0] ?? "";
  const embeddedIPv4 = /((?:\d{1,3}\.){3}\d{1,3})$/.exec(address);
  if (embeddedIPv4) return isPrivateIPv4(embeddedIPv4[1] ?? "");
  if (address === "::" || address === "::1") return true;
  const firstGroup = /^([0-9a-f]{0,4})/.exec(address)?.[1] ?? "";
  const first = Number.parseInt(firstGroup || "0", 16);
  return (
    Number.isNaN(first) ||
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link local fe80::/10
    (first & 0xff00) === 0xff00 // multicast
  );
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

function parsedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (url.username !== "" || url.password !== "") throw new Error("URL credentials are not allowed");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local and mDNS hosts are not allowed");
  }
  return url;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (net.isIP(url.hostname) !== 0) {
    if (isPrivateAddress(url.hostname)) throw new Error(`Blocked private or loopback address: ${url.hostname}`);
    return;
  }
  const records = await lookupHost(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error(`Host does not resolve: ${url.hostname}`);
  const blocked = records.find((record) => isPrivateAddress(record.address));
  if (blocked !== undefined) {
    throw new Error(`Host resolves to a blocked private or loopback address: ${url.hostname}`);
  }
}

function withTimeout(controller = new AbortController()): { signal: AbortSignal; stop: () => void } {
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  return {
    signal: controller.signal,
    stop: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}

function contentLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  const length = Number(value);
  return Number.isInteger(length) && length >= 0 ? length : null;
}

async function readBody(response: Response): Promise<string> {
  const declared = contentLength(response);
  if (declared !== null && declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download exceeds 5 MB limit (${declared} bytes)`);
  }
  if (response.body === null) return response.text();

  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for await (const chunk of response.body) {
    const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    bytes += size;
    if (bytes > MAX_DOWNLOAD_BYTES) throw new Error("Download exceeds 5 MB limit");
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function safeGet(url: URL): Promise<{ response: Response; stop: () => void }> {
  const { signal, stop } = withTimeout();
  let current = url;
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      await assertPublicHost(current);
      const response = await fetch(current, {
        signal,
        redirect: "manual",
        headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9", "user-agent": "Studium/0.0" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (location === null) throw new Error(`Redirect from ${current} has no Location header`);
        current = parsedUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}`);
      return { response, stop };
    }
    throw new Error("Too many redirects");
  } catch (error) {
    stop();
    throw error;
  }
}

function truncateBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  let length = Math.floor((text.length * maxBytes) / bytes);
  while (length > 0 && Buffer.byteLength(text.slice(0, length), "utf8") > maxBytes) length--;
  return `${text.slice(0, length)}\n\n[Truncated at 200 KB]`;
}

async function htmlToMarkdown(html: string, fallbackUrl: URL): Promise<string> {
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML(html);
  const { Readability } = await import("@mozilla/readability");
  const article = new Readability<string>(document as never).parse();
  const { default: TurndownService } = await import("turndown");
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  if (article !== null && article.content !== null && article.content !== undefined) {
    const title = article.title ?? fallbackUrl.hostname;
    return `# ${title}\n\n${turndown.turndown(article.content).trim()}\n`;
  }

  const bodyText = document.body?.textContent?.trim() ?? "";
  if (bodyText === "") throw new Error("Page contains no readable text");
  return `${turndown.turndown(html).trim()}\n`;
}

function firecrawlEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/scrape")) return trimmed;
  return trimmed.endsWith("/v1") ? `${trimmed}/scrape` : `${trimmed}/v1/scrape`;
}

async function firecrawlMarkdown(url: URL, opts: WebFetchOptions): Promise<string | null> {
  if (opts.firecrawlUrl === undefined) return null;
  const { signal, stop } = withTimeout();
  try {
    const response = await fetch(firecrawlEndpoint(opts.firecrawlUrl), {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(opts.firecrawlKey === undefined ? {} : { authorization: `Bearer ${opts.firecrawlKey}` }),
      },
      body: JSON.stringify({ url: url.toString(), formats: ["markdown"] }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const data = (payload as { data?: unknown }).data;
    if (typeof data !== "object" || data === null) return null;
    const markdown = (data as { markdown?: unknown }).markdown;
    return typeof markdown === "string" && markdown.trim() !== "" ? markdown : null;
  } catch {
    return null;
  } finally {
    stop();
  }
}

export function webFetchTool(opts: WebFetchOptions = {}): ToolDefinition {
  return defineTool({
    name: "web_fetch",
    label: "Fetch web page",
    description: "Fetch a public http(s) page and return readable markdown.",
    parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      try {
        const url = parsedUrl(params.url);
        await assertPublicHost(url);
        const firecrawl = await firecrawlMarkdown(url, opts);
        if (firecrawl !== null) {
          return result(`fetched ${url.hostname} with Firecrawl`, truncateBytes(firecrawl, MAX_MARKDOWN_BYTES));
        }
        const fetched = await safeGet(url);
        let html: string;
        try {
          html = await readBody(fetched.response);
        } finally {
          fetched.stop();
        }
        const markdown = await htmlToMarkdown(html, url);
        return result(`fetched ${url.hostname}`, truncateBytes(markdown, MAX_MARKDOWN_BYTES));
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}
