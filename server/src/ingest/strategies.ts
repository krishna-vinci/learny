import { arxivIdOf } from "./ids.js";
export interface FetchStrategy {
  kind: "wiki-api" | "arxiv-html" | "answer-order" | "firecrawl" | "readability";
  url: string;
  waitFor?: number;
}
/** Small explicit registry; never invent reader URLs for unknown sites. */
export function fetchStrategy(raw: string): FetchStrategy {
  const url = new URL(raw);
  if (/^(?:[a-z-]+\.)?(?:wikipedia|wikisource)\.org$/.test(url.hostname)) return { kind: "wiki-api", url: raw };
  const id = arxivIdOf(raw);
  if (id) return { kind: "arxiv-html", url: `https://arxiv.org/html/${id}` };
  if (url.hostname === "stackoverflow.com" && /^\/questions\/\d+/.test(url.pathname)) {
    url.searchParams.set("answertab", "scoredesc");
    return { kind: "answer-order", url: url.toString() };
  }
  if (/(?:^|\.)(?:openstax\.org|khanacademy\.org)$/.test(url.hostname))
    return { kind: "firecrawl", url: raw, waitFor: 2000 };
  return { kind: "readability", url: raw };
}
