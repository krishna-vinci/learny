import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseYoutubeVideo } from "@studium/shared/media";
import { Type } from "typebox";
import { detectInput } from "../../ingest/detect.js";
import { domainPreferences, recordDomainOutcome } from "../../ingest/domain-outcomes.js";
import { publicErrorReason } from "../../ingest/error-reason.js";
import { normalizeUrl } from "../../ingest/ids.js";
import { isImageSourceUrl } from "../../ingest/image-url.js";
import { MIN_PARSE_QUALITY, scoreParseQuality } from "../../ingest/quality.js";
import { assertPublicUrl } from "../../ingest/safe-fetch.js";
import { extract } from "../../ingest/types.js";
import type { Classifier } from "../classifier.js";
import { selectedPassage } from "../passage.js";

export interface ScoutCandidate {
  url: string;
  title: string;
  reason: string;
  score: number;
  type: string;
}
export interface ScoutedSource extends ScoutCandidate {
  quality: number | null;
  readable: boolean;
}
export function scoutSourcesTool(opts: {
  root: string;
  classifier?: Classifier;
  onSelected?: (sources: ScoutedSource[]) => void;
}): ToolDefinition {
  return defineTool({
    name: "scout_sources",
    label: "Evaluate source candidates",
    description:
      "Rank 10–20 search candidates per recipe slot, canonicalize, fetch top candidates and keep healthy parses. Search broadly first; scores/reasons are your LLM judgment when classifier is off or shadow. Does not register sources.",
    parameters: Type.Object({
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
        { minItems: 1, maxItems: 100 },
      ),
    }),
    async execute(_id, params, signal) {
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
          if (c.type === "video" && !parseYoutubeVideo(c.url))
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
      for (const c of ordered.filter((c) => c.score >= 3).slice(0, 6)) {
        signal?.throwIfAborted();
        try {
          await assertPublicUrl(c.url);
          if (c.type === "video") {
            selected.push({ ...c, quality: null, readable: false });
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
          } else
            selected.push({ ...c, url: normalizeUrl(extracted.url ?? c.url), quality: quality.score, readable: true });
        } catch (error) {
          signal?.throwIfAborted();
          const reason = publicErrorReason(error);
          if (/HTTP (401|403|451)/.test(reason)) await recordDomainOutcome(opts.root, c.url, "blocked");
          dropped.push({ url: c.url, reason });
        }
      }
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
