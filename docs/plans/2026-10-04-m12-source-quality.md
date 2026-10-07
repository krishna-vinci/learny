# M12 — Source quality: rich extraction, the right sources, perfect video use

**Goal:** chapters are only as good as their sources. Make every source extracted and parsed well (structure, math, tables, figures, sections), choose the right sources for the subject and level (papers only when research-level evidence is needed), and use YouTube videos exactly where a video teaches better than text — at the right moment.

**Out of scope:** MinerU (not used). Don't add services.

## Evidence (2026-10-04, from the owner's real data — re-check, don't re-derive)
- Chat logs: 32 `web_fetch` calls → 22 via Firecrawl, 10 failed. Failures: academic publishers 403 (tandfonline ×2, Wiley, academia.edu, RSC, IUPAC Gold Book), Met Museum 429, 404s (AKDN, Google Books). Firecrawl's own error is swallowed (`server/src/agent/builtins/web-fetch.ts` `firecrawlMarkdown` returns `null` on any error), so the agent only sees the direct fallback's "HTTP 403".
- Ingest job log: 8 failed / 26 done; failures include four YouTube "watch" (now handled by the transcript ladder), two Wikimedia `File:` image pages added as sources (should have been `save_asset`), "Principal component analysis" and "introduction-to-semiconductors" with **no recorded reason** (`log/jobs.md` lines carry no error).
- Breadth: ~30 searches in total across all chats; plans tend to rely on 1–3 sources; the polymers chapter is riddled with "Uncertain:" because sources were thin.
- Videos: 2 of 17 chapters link a video, both weak ("transcript is garbled", "unverified"). `plan-set` never mentions videos; the drafter can't add sources; no rule says when a video beats text. `media-authoring`/`draft-chapter` correctly use *already registered* videos.
- Existing pieces to build on: `server/src/ingest/{firecrawl,web,library,split,clean,wikipedia,youtube}.ts`, `server/src/youtube/` (transcript ladder), `server/src/search/` (FTS + passages), classifier layer (`server/src/agent/classifier.ts`, decisions; Jev), `skills/{find-sources,plan-set,draft-chapter,media-authoring}`, plan kickoff (`server/src/inbox/plan-kickoffs.ts`), course API (`server/src/course/`).

## Phase 1 — Measure, and fix fetch failures
1. **Parse-quality score** per source (a pure function + stored in `source.md` frontmatter as `quality: {score: 0–100, signals: {...}}`): main-text ratio vs boilerplate (nav/cookie/footer residue), heading structure present, broken characters/mojibake, garbled math (raw MathML/`\displaystyle` soup, `{\displaystyle …}` artefacts), tables intact, truncation markers, length vs expected. Script `server/scripts/source-audit.ts` scores every source in a tree (run on a temp copy of `data/users/<username>`) → `docs/plans/2026-10-04-m12-source-audit.md` table (worst first).
2. **`web_fetch` honesty and politeness:** report both Firecrawl's error and the direct error; on 429 retry once after `Retry-After` (cap 10 s); remember blocked hosts (403/401/451) for the rest of the job/chat and say so instead of retrying; for known paywall hosts and DOI URLs, return a hint: "paywalled — look for an open-access copy (papers tools) or a textbook/explainer instead".
3. **Job log reasons:** failed jobs append a short, secret-free reason to the `log/jobs.md` line (and the Activity panel already shows it).
4. **Image pages aren't sources:** `add_source` rejects image file pages/URLs (Wikimedia `File:`, direct image URLs) with "this is an image — save it with save_asset".

## Phase 2 — Structure-preserving extraction
5. **Math:** when the HTML contains rendered math with a TeX annotation (`<annotation encoding="application/x-tex">`, MathJax `script[type^="math/tex"]`, KaTeX `annotation`, Wikipedia `alttext` / `mwe-math-fallback`), emit `$…$` / `$$…$$` with the exact TeX instead of garbled text. Applies to Firecrawl HTML (request `html`/`rawHtml` format when needed) and the direct path.
6. **Tables** as GFM tables; **code** blocks with language; **figures** with caption + alt (feeding `images.json`); **headings** become stable section anchors used by citations (`[^src:id#section-slug]`) and by `split.ts`.
7. **Per-site fetch strategies** (a small registry `url pattern → strategy`, tested): Wikipedia/Wikisource via their APIs (existing `wikipedia.ts`), arXiv → its HTML version when available, Firecrawl with `waitFor` for JS-heavy pages, a site's print/reader view where known, Readability last. A source scoring below a threshold gets one retry with the next strategy; the better result wins.
8. **Section summaries:** each split section gets a one-line summary (cheap model or extractive first sentence — measure), used by retrieval and the drafter.
9. Re-import the 10 worst sources from the audit on the temp copy; re-score; before/after table.

## Phase 3 — The right sources (recipes + scouting)
10. **Source recipes** by subject × level (in `skills/find-sources/references/recipes.md` and used by `plan-set`): base slots = a textbook/OER (OpenStax, LibreTexts, MIT OCW, Stanford Encyclopedia of Philosophy, official docs for tech) + an expert explainer + a lecture video when the subject benefits; subject slots (primary sources for history, spec/RFC for tech, regulator/data for finance). **Research papers only** when level ≥ 4, the topic is recent (last ~3 years) or a central claim isn't covered by textbook-grade sources.
11. **Scouting:** search wide (10–20 candidates per slot, `web_search`/SearXNG), score candidates with a new classifier decision `sources.rank` (authority, depth, level fit, type, recency, relevance; shadow → on after calibration; LLM fallback when the classifier is off), fetch the top ones, keep those whose parse quality passes. Thin/SEO pages dropped. Dedupe mirrors/AMP/tracking URLs to a canonical URL.
12. **Learning:** record per-domain outcomes (cited in checked chapters, blocked, low quality) in the workspace `.cache/`; scouting ranks known-good domains up and failing ones down.

## Phase 4 — Coverage before drafting
13. After plan approval (kickoff) and before each draft: list the chapter's key concepts (from the curriculum scope), check coverage against imported sections via the FTS index, run targeted scouting for gaps, then draft. Store a per-chapter **evidence coverage** (covered/total concepts + weakest concepts) and show it as an evidence meter on Course plan rows.

## Track V — Perfect video use (runs alongside Phases 3–4)
14. **When a video beats text** (rule in `media-authoring` + `draft-chapter`, and a `video.useful` classifier decision): motion/process, physical demos/labs, spatial manipulation, a teacher working a problem step by step, pronunciation/language, real-world footage, historical footage, performance/skills. Not for: definitions, lists, text-heavy facts, anything the chapter already explains as well.
15. **Planner proposes videos:** `plan-set` includes 1–3 lecture/demo videos per set when the subject benefits, found by scouting with a video filter: named educator/institution, **manual captions preferred** over auto, length fits (5–30 min for chapter moments), level fit, recent enough, not a channel/playlist page. Kickoff ingests them via the transcript ladder.
16. **Moment selection:** the drafter picks the moment from the transcript's `<!-- t:N -->` markers that best matches the concept (FTS over the transcript sections), embeds `::youtube{src start end}` right after the paragraph it supports (start ≥ the marker, end ≤ ~3 min later), and cites `[^src:id#tN]`. One video moment per concept at most; never at the top of a chapter as decoration.
17. **No-transcript videos:** embed-only sources (transcript blocked) can be linked as "watch" but never cited for claims; the drafter says so in a muted line.
18. **Checker:** flags a video moment whose transcript section doesn't match the adjacent paragraph's concept, and a concept where the rule in 14 says a video would help but the set has a suitable registered video unused.

## Rules
- Read `AGENTS.md`, `AGENT_MEMORY.md`, `docs/PRINCIPLES.md`, `docs/decisions/LOG.md` (D19, D29–D33). Add **D34 — Source quality** (score, recipes, papers-when-needed, coverage, video rule).
- SSRF guard (`assertPublicUrl`/`safeFetch`) and the untrusted-evidence rule unchanged. No new dependencies (HTML parsing via what's already installed — check `server/package.json`; if TeX extraction needs a DOM, use the parser already used by `web.ts`/Readability).
- `data/` is read-only: run audits, re-imports and evals on a temp copy. Keys only via `--env-file` into script processes, never printed. **No fixed call cap** on subscription providers; loop guard (stop a case after 3 identical failures). Report usage per provider (fresh / output / cache read / cache write).
- Tests use fakes (no network). Scoped tests: touched test files + `server/src/ingest/`, `server/src/search/`, `server/src/tree/` dirs; `tsc --noEmit` server/web/shared; web build; biome on changed files.
- Write progress into `docs/plans/2026-10-04-m12-source-quality-report.md` after each phase (network cuts happen).
- Final report: per phase — changed files, tests with counts, audit before/after, recipe/scouting comparison on 3 subjects (polymers, Hyderabad history, linear algebra: which sources today vs proposed, with quality scores), a redraft of one polymers-style chapter on the temp copy with "Uncertain:" count before/after, video track results (which videos proposed, moments chosen, quoted), usage per provider, deviations, 5-line log entry.
