import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { detectInput } from "../../ingest/detect.js";
import { domainPreferences, recordDomainOutcome } from "../../ingest/domain-outcomes.js";
import { publicErrorReason } from "../../ingest/error-reason.js";
import { normalizeUrl } from "../../ingest/ids.js";
import { isImageSourceUrl } from "../../ingest/image-url.js";
import { collectImages, type SourceImage } from "../../ingest/images.js";
import { MIN_PARSE_QUALITY, scoreParseQuality } from "../../ingest/quality.js";
import { assertPublicUrl } from "../../ingest/safe-fetch.js";
import { extract } from "../../ingest/types.js";
import { isWatchVideo, type SearchService } from "../../search/backends.js";
import { chapterConcepts, measureCoverage } from "../../search/coverage.js";
import type { Classifier } from "../classifier.js";
import { selectedPassage } from "../passage.js";
import { searchParameters } from "./web-search.js";

export interface ScoutCandidate {
  url: string;
  title: string;
  reason: string;
  score: number;
  type: string;
  images?: SourceImage[];
}
export interface ScoutedSource extends ScoutCandidate {
  quality: number | null;
  readable: boolean;
}
export function scoutSourcesTool(opts: {
  root: string;
  classifier?: Classifier;
  search?: SearchService;
  onSelected?: (sources: ScoutedSource[]) => void;
}): ToolDefinition {
  const discoveredImages = new Map<string, SourceImage[]>();
  return defineTool({
    name: "scout_sources",
    label: "Evaluate source candidates",
    description:
      "Rank 10–20 search candidates per recipe slot, canonicalize, fetch top candidates and keep healthy parses. Search broadly first; scores/reasons are your LLM judgment when classifier is off or shadow. Does not register sources.",
    parameters: Type.Object({
      search: Type.Optional(Type.Object(searchParameters)),
      brief: Type.String(),
      level: Type.Integer({ minimum: 1, maximum: 5 }),
      researchNeeded: Type.Boolean(),
      candidates: Type.Array(
        Type.Object({
          url: Type.String(),
          title: Type.String(),
          reason: Type.String(),
          score: Type.Integer({ minimum: 0, maximum: 5 }),
          type: Type.Union([
            Type.Literal("textbook"),
            Type.Literal("explainer"),
            Type.Literal("primary"),
            Type.Literal("docs"),
            Type.Literal("paper"),
            Type.Literal("video"),
          ]),
        }),
        { minItems: 0, maxItems: 100 },
      ),
    }),
    async execute(_id, params, signal) {
      if (params.search) {
        if (!opts.search) throw new Error("Search is unavailable");
        const leads = await opts.search.search({ brief: params.brief, ...params.search }, signal);
        for (const lead of leads.results) if (lead.images?.length) discoveredImages.set(lead.url, lead.images);
        return {
          content: [
            {
              type: "text" as const,
              text: selectedPassage(
                JSON.stringify({
                  ...leads,
                  discoveryCoverage: measureCoverage(
                    chapterConcepts(params.brief, params.search.concept || params.brief),
                    leads.results.map((r, i) => ({
                      id: String(i),
                      source: r.url,
                      file: "",
                      anchor: "",
                      text: r.highlights?.join("\n") || r.snippet,
                      cited: false,
                      score: 0,
                    })),
                  ),
                }),
                "source scouting search leads; rank these with reasoned scores and call scout_sources again",
              ),
            },
          ],
          details: { isError: !leads.results.length, summary: `${leads.results.length} leads to rank` },
        };
      }
      const seen = new Set<string>();
      const candidates: ScoutCandidate[] = [];
      const dropped: { url: string; reason: string }[] = [];
      for (const c of params.candidates) {
        try {
          const url = new URL(c.url);
          if (url.username || url.password || !/^https?:$/.test(url.protocol) || isImageSourceUrl(url))
            throw new Error("not a public text/video candidate");
          if (c.type === "paper" && params.level < 4 && !params.researchNeeded)
            throw new Error("Use textbook-grade evidence at this level");
          if (c.type === "video" && !isWatchVideo(c.url, c.title))
            throw new Error("Use an individual video, not a channel or playlist");
          const canonical = normalizeUrl(c.url);
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          candidates.push({ ...c, url: canonical });
        } catch (error) {
          dropped.push({ url: c.url, reason: publicErrorReason(error) });
        }
      }
      const ranked = opts.classifier
        ? await opts.classifier.decide("sources.rank", {
            state: {
              brief: params.brief,
              level: params.level,
              candidates: candidates.map((c, i) => ({ id: String(i), text: JSON.stringify(c), score: c.score })),
            },
          })
        : null;
      const domains = await domainPreferences(opts.root);
      const ordered = candidates
        .map((c, i) => ({
          ...c,
          score: ranked?.answer[String(i)] ?? c.score,
          priority:
            (ranked?.answer[String(i)] ?? c.score) +
            (domains.get(new URL(c.url).hostname.toLowerCase().replace(/^www\./, "")) ?? 0),
        }))
        .sort((a, b) => b.priority - a.priority);
      const selected: ScoutedSource[] = [];
      const passedUrls: string[] = [];
      for (const c of ordered.filter((c) => c.score >= 3).slice(0, 6)) {
        signal?.throwIfAborted();
        try {
          await assertPublicUrl(c.url);
          if (c.type === "video") {
            selected.push({ ...c, quality: null, readable: false });
            passedUrls.push(c.url);
            continue;
          }
          const extracted = await extract(
            detectInput({ url: c.url }),
            { url: c.url },
            {
              signal,
              firecrawlUrl: process.env.FIRECRAWL_API_URL,
              firecrawlKey: process.env.FIRECRAWL_API_KEY,
            },
          );
          const quality = scoreParseQuality(extracted.markdown);
          if (quality.score < MIN_PARSE_QUALITY || quality.signals.characters < 800) {
            await recordDomainOutcome(opts.root, c.url, "low-quality");
            dropped.push({
              url: c.url,
              reason: `Thin/damaged parse (${quality.score}, ${quality.signals.characters} characters)`,
            });
          } else {
            passedUrls.push(c.url);
            selected.push({
              ...c,
              url: normalizeUrl(extracted.url ?? c.url),
              quality: quality.score,
              readable: true,
              images: [
                ...(extracted.images ?? collectImages(extracted.markdown, c.url)),
                ...(discoveredImages.get(c.url) ?? opts.search?.imagesFor(c.url) ?? []),
              ]
                .filter((image, i, all) => all.findIndex((other) => other.url === image.url) === i)
                .slice(0, 50),
            });
          }
        } catch (error) {
          signal?.throwIfAborted();
          const reason = publicErrorReason(error);
          if (/HTTP (401|403|451)/.test(reason)) await recordDomainOutcome(opts.root, c.url, "blocked");
          dropped.push({ url: c.url, reason });
        }
      }
      const fallbackLeads = await opts.search?.fallbackAfterScout(
        candidates.map((c) => c.url),
        passedUrls,
        signal,
      );
      if (fallbackLeads)
        for (const lead of fallbackLeads.results) if (lead.images?.length) discoveredImages.set(lead.url, lead.images);
      opts.onSelected?.(selected);
      const summary = `${selected.length} source candidates passed; ${dropped.length} dropped`;
      return {
        content: [
          {
            type: "text" as const,
            text: selectedPassage(
              JSON.stringify({
                selected,
                dropped,
                ...(fallbackLeads
                  ? {
                      fallbackLeads,
                      nextStep: "Rank these fallback leads and call scout_sources again; report any remaining gaps.",
                    }
                  : {}),
                ranking: ranked?.source ?? "LLM judgment",
                mode: ranked?.mode ?? "off",
              }),
              "source scouting results",
            ),
          },
        ],
        details: { isError: false, summary },
      };
    },
  });
}
