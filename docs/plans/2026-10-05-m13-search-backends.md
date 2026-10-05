# M13 — Search backends (Exa + SearXNG), subject coverage, refresh sources

**Goal:** source scouting finds the best teaching sources for any subject, measured not assumed; existing libraries get M12's better extraction.

## Facts (2026-10-05)
- `EXA_API_KEY` is set in the app's `.env` (the server loads `.env`; scripts get it only via `--env-file`, never printed). Brave/Tavily are out of scope.
- SearXNG (`SEARXNG_URL`, a self-hosted instance) now answers general web from bing + yandex + wikibooks/wikiversity/wikiquote/wikisource/openlibrary (a philosophy query returned 55 results from 7 engines); science from arxiv, crossref, pubmed, semantic scholar, openalex, google scholar, openaire. google/duckduckgo/brave/startpage/mojeek/qwant/presearch are IP-blocked — don't depend on them. Unknown engine names silently fall back to defaults — never trust an `engines=` result without checking which engines answered.
- M12 built: `scout_sources` (`server/src/agent/builtins/scout-sources.ts`), recipes (`skills/find-sources/references/recipes.md`), `sources.rank`, parse-quality score, pre-draft coverage (`server/src/jobs/source-preflight.ts`), D34. Read the M12 report `docs/plans/2026-10-04-m12-source-quality-report.md`.
- Subjects: `PlanSubject` in `shared/src/schemas.ts` (math, science, technology, history, finance, language, practical, general). Philosophy is lumped into history/humanities; politics, law and economics fall to general.

## Part 1 — Exa backend
- A search backend interface used by `web_search`/`scout_sources`: SearXNG (existing) and **Exa** (`EXA_API_KEY`; absent → SearXNG only, exactly as today). Exa features to use: neural search with a natural-language description of the wanted source, `category` filters (e.g. research paper, pdf), include/exclude domains (from recipes), **find-similar** from a known good source, and returned page text when useful (still parse-scored; fetched URLs still go through `assertPublicUrl`/`safeFetch` and untrusted-data wrapping). Results normalised to one shape (url, title, snippet, published date, backend).
- Routing per slot (recipe-driven): explainers/textbook-grade/primary-source/expert slots → Exa first; papers → SearXNG science engines (+ Exa research-paper category); videos → SearXNG videos; news/recent → SearXNG general. Merge + canonical dedupe across backends.
- **Gentle search:** per-backend pacing (SearXNG ≥ 1.5 s between queries per job; Exa within its documented rate limit), a short-lived query cache in the workspace `.cache/`, and no retry storms (loop guard).
- Usage accounting: Exa requests/cost per job (Exa returns cost info; record it) shown in job usage like model tokens.

## Part 2 — Bake-off (measure, then set defaults)
`server/scripts/search-bakeoff.ts`: ~24 real queries — recipe slots for polymers, Hyderabad history, linear algebra, Stoic philosophy, Indian parliamentary politics, contract law basics (generate from the recipes; list them in the report). For each query run Exa and SearXNG (top 10 each). Score every result: fetched parse quality (M12 scorer), `sources.rank` (or LLM fallback), recipe fit, usable (not blocked/paywalled/SEO), unique to that backend. Report `docs/plans/2026-10-05-m13-search-bakeoff.md`: per subject × slot winner, cost per usable source, examples quoted. Set the routing defaults from the data (document any change). No fixed call cap on subscription providers; loop guard; report Exa spend and model usage per provider (fresh/output/cache).

## Part 3 — Subjects
- Add `PlanSubject` values `philosophy`, `politics`, `law`, `economics` (tolerant parsing stays: unknown → general).
- Recipes + teaching guides (`skills/draft-chapter/references/subject-*.md`, same shape and length as the existing ones, model excerpt marked style-only):
  - philosophy: Stanford/Internet Encyclopedia of Philosophy, primary texts (Wikisource/Gutenberg), PhilPapers survey articles; present positions of major schools with their strongest arguments.
  - politics: primary documents (constitutions, parliamentary records, official statistics), multiple attributed perspectives, every claim dated, never a single partisan outlet as sole evidence.
  - law: statutes and case law tagged by jurisdiction and date; "not legal advice" framing.
  - economics: official data (central banks, IMF/World Bank, statistics offices) dated, textbooks, competing schools where contested.
- `docs/TEACHING.md` (+ its shipped copy): a **contested-topics rule** — present major viewpoints fairly with attribution, separate facts from interpretations, date time-sensitive claims, never state a political/moral judgement as fact. Checker treats violations as blockers for politics/philosophy/law/economics chapters.
- `plan-set` picks the new subjects; register skill changes via `scripts/skill-history.mjs` (+ biome format).

## Part 4 — Refresh sources
- `POST` route + job `refresh-source` (and "refresh all in this set"): re-import an existing library source with the M12 extraction pipeline, keep its id/citations/anchors where sections still match (report anchors that disappeared), commit as librarian, show quality before/after. UI: "Refresh" on the source page, "Refresh all sources" on the Library page filtered by set, with a summary toast. Never touches sources whose original was an uploaded file unless the original is present; skips blocked hosts with a clear reason.

## Rules
- Read `AGENTS.md`, `AGENT_MEMORY.md`, `docs/PRINCIPLES.md`, `docs/decisions/LOG.md` (D19, D33, D34). Add D35 (search backends + routing + contested topics).
- No new npm dependencies (Exa via `fetch` to its HTTPS API). Tests fake Exa/SearXNG/network. `data/` read-only — bake-off and refresh trials on temp copies.
- Scoped tests (touched files + `server/src/ingest/`, `server/src/search/`, `server/src/tree/`), `tsc --noEmit` server/web/shared, web build, biome on changed files.
- Progress into `docs/plans/2026-10-05-m13-search-backends-report.md` after each part. Final message: changed files, tests with counts, bake-off summary table, refresh trial before/after, Exa spend + model usage per provider, deviations, 5-line log entry.
