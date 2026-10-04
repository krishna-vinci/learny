import { cardsPrescreen } from "./cards.prescreen.js";
import { checkDepth } from "./check.depth.js";
import { contextRelevance } from "./context.relevance.js";
import { gradeTriage } from "./grade.triage.js";
import { ingestKind } from "./ingest.kind.js";
import { sourcesRank } from "./sources.rank.js";
import { tutorIntent } from "./tutor.intent.js";
import { videoUseful } from "./video.useful.js";
import { visualRouter } from "./visual.router.js";
export const DECISIONS = {
  "sources.rank": sourcesRank,
  "video.useful": videoUseful,
  "tutor.intent": tutorIntent,
  "context.relevance": contextRelevance,
  "check.depth": checkDepth,
  "cards.prescreen": cardsPrescreen,
  "visual.router": visualRouter,
  "grade.triage": gradeTriage,
  "ingest.kind": ingestKind,
};
export type DecisionName = keyof typeof DECISIONS;
export type DecisionAnswer<N extends DecisionName> = ReturnType<(typeof DECISIONS)[N]["decode"]>;
