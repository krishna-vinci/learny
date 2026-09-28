import { decodeBody, SAFE_FETCH_MAX_BYTES, safeFetch } from "./safe-fetch.js";
import { type Extracted, UnsupportedInputError } from "./types.js";
import { htmlToMarkdown } from "./web.js";

const WIKI_HOST = "en.wikipedia.org";

/** Extract a Wikipedia article (English) to markdown via the REST API. */
export async function extractWikipedia(url: string, options: { signal?: AbortSignal } = {}): Promise<Extracted> {
  const title = wikipediaTitle(url);
  const endpoint = `https://${WIKI_HOST}/api/rest_v1/page/html/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const response = await safeFetch(endpoint, { signal: options.signal, maxBytes: SAFE_FETCH_MAX_BYTES });
  const converted = htmlToMarkdown(decodeBody(response.bytes, response.contentType), endpoint);
  return {
    title: converted.title ?? title.replace(/_/g, " "),
    authors: [],
    markdown: converted.markdown,
    pages: null,
    parseTier: "basic",
    warning: converted.markdown.trim() === "" ? "no readable content found" : null,
    url,
    originalExt: null,
  };
}

function wikipediaTitle(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new UnsupportedInputError("wikipedia", `Not a valid Wikipedia URL: ${url}`, { cause });
  }
  const fromPath = /\/wiki\/(.+)$/.exec(parsed.pathname);
  if (fromPath?.[1] !== undefined && fromPath[1] !== "") return decodeURIComponent(fromPath[1]);
  const fromQuery = parsed.searchParams.get("title");
  if (fromQuery !== null && fromQuery !== "") return fromQuery;
  throw new UnsupportedInputError("wikipedia", `Wikipedia URL has no article title: ${url}`);
}
