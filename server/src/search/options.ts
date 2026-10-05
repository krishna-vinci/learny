import { parseFrontmatter, SearchConfig } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import { readText } from "../tree/edit.js";
import type { SearchRequest, SearchSlot } from "./backends.js";

export const EXA_CATEGORIES = [
  "company",
  "publication",
  "news",
  "personal site",
  "financial report",
  "people",
] as const;
export type ExaCategory = (typeof EXA_CATEGORIES)[number];
export interface SearchContext {
  set?: string | null;
  subject?: string;
  planText?: string;
  brief?: string;
}
const recipes: Record<SearchSlot, { purpose: string; category?: ExaCategory; subpages?: number }> = {
  foundation: { purpose: "Structured textbook or course lesson with examples", subpages: 3 },
  explainer: { purpose: "Substantial accessible explanation" },
  primary: { purpose: "Original texts, official documents and primary evidence" },
  expert: { purpose: "Named specialist teaching and attributed interpretations", category: "personal site" },
  paper: { purpose: "Scholarly publications", category: "publication" },
  video: { purpose: "Individual educator demonstration video" },
  recent: { purpose: "Dated current reporting", category: "news" },
};
export async function searchConfig(root: string): Promise<SearchConfig> {
  try {
    const raw = parseYaml(await readText(root, "_global/config.yaml"));
    return SearchConfig.parse(raw?.search);
  } catch {
    return SearchConfig.parse(undefined);
  }
}
export async function withPlanContext(root: string, req: SearchRequest): Promise<SearchRequest> {
  if (!req.set || req.planText) return req;
  const planText = await readText(root, `${req.set}/PLAN.md`).catch(() => "");
  try {
    return {
      ...req,
      planText,
      subject: req.subject ?? String(parseFrontmatter(planText).frontmatter.subject ?? "general"),
    };
  } catch {
    return { ...req, planText };
  }
}
/** One recipe contract for live scouting and the comparative experiment. */
export function buildExaOptions(
  req: SearchRequest,
  config = SearchConfig.parse(undefined),
  now = new Date(),
  failedScout = false,
) {
  const recipe = recipes[req.slot ?? "explainer"];
  const concept = req.concept || req.query;
  const context = `${req.subject ?? ""} ${req.planText ?? ""} ${req.brief ?? ""} ${concept}`;
  const historical =
    req.historical ??
    /\b(history|historical|ancient|medieval|pre-?\d{4})\b/i.test(`${req.subject ?? ""} ${req.brief ?? ""} ${concept}`);
  const timeSensitive = req.slot === "recent" || /^(politics|economics|technology)$/.test(req.subject ?? "");
  const category =
    req.slot === "paper" || req.category === "research paper" || req.category === "pdf"
      ? "publication"
      : (req.category ??
        recipe.category ??
        (req.subject === "finance" && req.slot === "primary"
          ? "financial report"
          : !historical && /^(politics|economics)$/.test(req.subject ?? "") && req.slot === "explainer"
            ? "news"
            : undefined));
  const restricted = category === "company" || category === "people";
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  const location =
    req.userLocation ??
    config.exa.userLocation ??
    (config.exa.detectIndia && /\b(india|indian|hyderabad|deccan|sansad|rupees?|rbi|ncert)\b/i.test(context)
      ? "IN"
      : undefined);
  return {
    type: req.similarUrl
      ? "fast"
      : req.purpose === "verify"
        ? "instant"
        : req.purpose === "hard-gap" && failedScout
          ? "deep-lite"
          : "auto",
    numResults: Math.max(1, Math.min(100, req.count ?? 10)),
    ...(category ? { category } : {}),
    ...(req.slot === "video"
      ? { includeDomains: ["youtube.com"] }
      : req.includeDomains?.length
        ? { includeDomains: req.includeDomains }
        : {}),
    ...(!restricted && req.excludeDomains?.length ? { excludeDomains: req.excludeDomains } : {}),
    ...(!restricted && timeSensitive && !historical
      ? {
          startPublishedDate: start.toISOString(),
          endPublishedDate: now.toISOString(),
        }
      : {}),
    ...(location ? { userLocation: location } : {}),
    objective: `${req.brief || concept}\n${recipe.purpose}`.slice(0, 4096),
    moderation: true,
    contents: {
      ...(req.text
        ? {
            text: {
              maxCharacters: 18000,
              verbosity: "standard",
              excludeSections: ["navigation", "footer", "comments"],
            },
          }
        : { highlights: { query: concept.slice(0, 2000) } }),
      extras: { imageLinks: 5 },
      ...(recipe.subpages ? { subpages: recipe.subpages, subpageTarget: [concept.slice(0, 2000)] } : {}),
      maxAgeHours: category === "news" ? 0 : 168,
      livecrawlTimeout: 10000,
    },
  };
}

/** SearXNG receives keywords from the same concept/slot rather than source-description prose. */
export function keywordQuery(req: SearchRequest): string {
  const suffix: Record<SearchSlot, string> = {
    foundation: "textbook university course",
    explainer: "explanation tutorial",
    primary: "official primary source",
    expert: "expert analysis",
    paper: "research paper",
    video: "lecture demonstration",
    recent: "news recent",
  };
  return `${req.concept || req.query} ${suffix[req.slot ?? "explainer"]}`.slice(0, 2000);
}
