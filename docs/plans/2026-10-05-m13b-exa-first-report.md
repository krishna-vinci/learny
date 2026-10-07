# M13b — Exa first implementation report

Specification: owner's M13b prompt; local implementation on `codex/m13b`, no delegation, commits, production writes or configuration/credential changes.

Implementation plan and progress:

- [x] Install frozen dependencies; read owner memory, constraints, specs and M13 evidence.
- [x] Centralize recipe options and conditional routing; papers MCP first, Exa publication fallback, Exa first for YouTube and other slots.
- [x] Persist workspace spend with a serialized pre-call guard, UTC month rollover, tolerant config and one stop notification.
- [x] Expose monthly spend/status in Settings → Integrations; carry chapter/plan context into options and highlight discovery coverage.
- [x] Verify scoped fakes (90 unique server, 7 shared, 3 web), package types, web build and 25-file Biome.
- [x] Complete 24-case fair re-bake-off; retain original report, append measured results, retain N=3.
- [x] Complete changed-file/check/usage/deviation report and five-line handoff log.
- [x] Apply official Exa skill; correct extraction/deprecations, wire papers MCP, restrict videos, run seven-query follow-up.

Design choices: initial fallback threshold 3 unique usable discovery leads, capped by requested count. Discovery usability requires title, content and healthy text when present; this does not assert factual truth or replace independent extraction/ranking. Budget uses atomic private `.cache/exa-budget.json`, serialized across service instances in the single server process. Default warning $8 and stop $9.50; stop is checked before a request, so the last response can cross the soft limit. Missing cost or damaged/unwritable telemetry fails closed. Month boundaries are UTC. No provider probe from Settings.

Progress at implementation verification: 89 scoped server tests passed in 12 files;
7 shared and 3 Settings tests passed. Server/web/shared tsc and web build passed.
Initial fixtures needed pacing-aware timeout bounds, removal of an empty temporary
cache before symlink installation, and a valid non-empty role map/Extracted shape.
Those failures were corrected and rerun; no pre-existing failures were encountered.
Search figures now reach preflight -> existing images.json. Rank/fetch rejection
requests SearXNG fallback leads once and permits an explicit hard-gap retry.
The first live experiment is `/tmp/studium-m13-bakeoff-8rMesr`, all 24 cases judged,
with $0.168 of reported Exa charges. The follow-up adds seven judged cases and $0.049. Production
config/data were not written; credentials entered only via node --env-file.

## Changed files

- `server/src/search/papers.ts`: role-approved MCP aggregate/individual search adapter, safe normalized metadata, DOI and open-access links; no download tools.
- `server/src/search/papers.test.ts`: aggregate request/metadata, source errors, unavailable MCP and failed searches using fakes.
- `server/src/agent/roles.test.ts`: prove outliner scout_sources reaches papers MCP through native routing.
- `server/scripts/search-bakeoff-specialized.ts`: resumable four-paper/three-video metadata comparison and append-only report section; no transcript/full-text assumptions.
- `server/src/search/options.ts`: one recipe builder for Exa modes/categories/dates/location/content, plan context and SearXNG slot keywords.
- `server/src/search/options.test.ts`: slot/subject, historical/restricted filters, location and retry controls.
- `server/src/search/budget.ts`: atomic confined workspace ledger, UTC rollover, serialized check/debit, uncertainty handling and persisted stop notification.
- `server/src/search/budget.test.ts`: restart/month accumulation, concurrent guard, notification failures, missing cost, corruption/symlinks and interrupted requests.
- `server/src/search/backends.ts`: Exa-first conditional routing, normalized highlights/summary/figures/subpages, cost parsing, post-scout fallback and usage accounting.
- `server/src/search/backends.test.ts`: routing/fallback triggers, canonical merge, cost parsing, content shape and hard-gap gating.
- `server/src/agent/builtins/web-search.ts`: expose valid categories, concept/brief/subject/location/history/purpose and 1–100 results.
- `server/src/agent/builtins/scout-sources.ts`: concept-highlight discovery coverage, image retention and rank/fetch fallback leads.
- `server/src/agent/builtins/scout-sources.test.ts`: highlight coverage and figure retention with fake search/extraction.
- `server/src/agent/run-role.ts`: attach safe PLAN/subject/task context and share the preflight search service.
- `server/src/jobs/source-preflight.ts`: share context/usage-aware search with the scout and pass figure candidates into inline ingestion.
- `server/src/jobs/source-preflight.test.ts`: check figure forwarding alongside existing transcript/coverage contracts.
- `server/src/jobs/ingest-job.ts`: merge bounded safe scout figures into the existing extracted image list.
- `server/src/jobs/ingest-job.test.ts`: verify persisted images.json, dedupe and SVG exclusion with fakes.
- `server/src/routes/settings.ts`: expose private monthly budget status without an Exa health request.
- `server/src/routes/settings.test.ts`: verify persisted spend/status and secret-free, no-probe response.
- `server/src/workspaces/manager.ts`: route one stop notification to the workspace owner; unsubscribe on stop.
- `server/src/workspaces/manager.test.ts`: verify owner-only notification and no duplicate after workspace restart.
- `shared/src/schemas.ts`: tolerant, backward-compatible search.exa configuration.
- `shared/src/api.ts`: optional ExaBudgetStatus projection for Settings.
- `shared/src/frontmatter.test.ts`: legacy and partially invalid configuration behavior.
- `web/src/components/Settings/IntegrationsSection.tsx`: month-to-date spend, active/warning/stopped/off/unavailable state and fallback explanation.
- `web/src/components/Settings/IntegrationsSection.test.tsx`: monthly spend and stop-state copy.
- `server/scripts/search-bakeoff.ts`: fair slot keywords/options, append-only original preservation, resumable experiment and serialized judging with bounded concurrent fetch work.
- `skills/find-sources/references/recipes.md`: correct paper/recent routing/categories, context controls and honest hard-gap/fallback guidance.
- `skills/.defaults-history.json`: record the final recipe hash for default-skill updates.
- `docs/decisions/LOG.md`: amend D35 routing, options, budget and comparison policy.
- `docs/DEPLOY.md`: config/defaults, UTC budget behavior, uncertainty and accounting limits.
- `docs/plans/2026-10-05-m13-search-bakeoff.md`: retain M13 and append the fair M13b experiment.
- `docs/plans/2026-10-05-m13b-exa-first-report.md`: plan, progress, validation, usage and handoff.

## Tests and checks

All automated tests use fakes and temporary workspaces. No full suite ran.

| Exact command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Passed; existing lockfile, no dependency additions. Ignored dependency build-script warning only. |
| `pnpm --filter @studium/server exec vitest run src/search/ src/routes/settings.test.ts src/agent/builtins/scout-sources.test.ts src/agent/roles.test.ts src/jobs/source-preflight.test.ts src/jobs/ingest-job.test.ts src/workspaces/manager.test.ts` | 89 passed / 0 failed, 12 files. |
| `pnpm --filter @studium/server exec vitest run src/workspaces/manager.test.ts -t 'delivers one Exa'` | 1 passed / 0 failed, 6 skipped; additional owner/restart notification behavior. |
| `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts -t 'returns highlights'` | 1 passed / 0 failed, 11 skipped; final summary-field addition. |
| `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts -t 'falls back after rank'` | 1 passed / 0 failed, 11 skipped; narrowed slot-scoped pending-scout change. |
| `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` | 7 passed / 0 failed. |
| `pnpm --filter @studium/web exec vitest run src/components/Settings/IntegrationsSection.test.tsx` | 3 passed / 0 failed. |
| `pnpm --filter @studium/server exec tsc --noEmit` | Passed. |
| `pnpm --filter @studium/web exec tsc --noEmit` | Passed. |
| `pnpm --filter @studium/shared exec tsc --noEmit` | Passed. |
| `pnpm --filter @studium/web build` | Passed; existing >500 kB chunk warning only. |
| `node scripts/skill-history.mjs` | Passed; kept only the final new recipe hash and existing history. |
| `git diff --check` | Passed. |

Earlier exact development commands (recorded for the failure/correction counts):

- `pnpm --filter @studium/server exec vitest run src/search/ src/routes/settings.test.ts src/agent/builtins/scout-sources.test.ts src/agent/roles.test.ts src/agent/run-role.test.ts`: 64 passed / 3 failed. There is no run-role.test.ts in this repo; roles.test.ts covers runRole, and the subsequent scoped runs omit that nonexistent filter.
- `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts src/search/budget.test.ts -t 'routes every|falls back for errors|does not follow cache'`: 3 passed / 0 failed, 12 skipped.
- `pnpm --filter @studium/server exec vitest run src/jobs/ingest-job.test.ts -t 'persists scout figure'`: 1 passed / 0 failed, 10 skipped.

Development runs before these passes: the first server run had 64 passed/3 failed
(two pacing timeouts and one symlink fixture EEXIST); the next had 86 passed/1 failed
(empty YAML roles in the new ingest fixture). Narrow corrections passed 3/3 and
1/1 respectively. The initial server tsc exposed the new tests' unknown JSON type
and invalid Extracted fixture shape; both were corrected before the passing check.
The first final Biome pass found one new test indentation error; formatted it and
then all 25 changed TypeScript/TSX/JSON files passed with zero findings.

Additional final freshness/cache checks:

- `pnpm --filter @studium/server exec vitest run src/search/options.test.ts src/search/backends.test.ts -t 'sets freshness|merges canonical duplicates'`: 2 passed / 0 failed, 14 skipped.
- `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts -t 'merges canonical duplicates'`: final time-sensitive cache fixture: 1 passed / 0 failed, 11 skipped.

## Re-bake-off and external usage

Live command, issued from `server/`:

```sh
node --env-file=/path/to/studium/.env --import tsx scripts/search-bakeoff.ts
node --env-file=/path/to/studium/.env --import tsx scripts/search-bakeoff.ts /tmp/studium-m13-bakeoff-8rMesr
```

Evidence: `/tmp/studium-m13-bakeoff-8rMesr/results.json`, `usage.json`,
`usage.json.events.jsonl`, `.cache/exa-budget.json`. Exa options, SearXNG keywords,
per-source rank/fit/accessibility/fetch outcomes and usage are appended to the
original bake-off report. All 24 judgments are complete; measured table and provider totals follow below.

The single-case process was stopped by its own saved PID after a pre-resume check
observed no outstanding Exa/model request, then resumed from saved state with
three active cases, four total fetch slots and one model judge. One judge request
started across that check/signal boundary and has no final usage event; it remains
counted as an attempted call, with unknown tokens rather than guessed zeros. This avoids idle fetch slots
behind slow sites without increasing Exa search volume; no production process was
stopped. Completed search/judgment evidence was reused.

## Deviations and limitations

- Calendar months are UTC, explicitly documented in config/UI/deploy notes.
- The guard starts at zero on installation; it does not import pre-M13b account
  billing. Local cache deletion or other workspace/external key usage is outside
  its protection. The final paid request may cross a soft limit.
- Missing cost, damaged/unwritable/symlinked persistence or an interrupted request
  stops further Exa calls. Notification delivery is attempted once; an unavailable
  channel never fails teaching and is not retried on restart.
- Discovery coverage from highlights is labeled separately. True imported-source
  coverage is recomputed only after safe extraction/ingestion; the independent
  checker remains mandatory. The scout refines N against actual rank/fetch outcomes.
- No paid setup probes, actual notification sends, commits, pushes, branch changes,
  production service changes or writes to AGENT_MEMORY.md/.env*/.claude/data.
- The benchmark's politics publication-date filters use the captured UTC-midnight
  cutoff. Final app code includes same-day news through the actual request time;
  moving date bounds do not defeat the normal 15-minute cache. No extra paid
  comparison was issued solely to shift this evaluation cutoff.
- Browser visual QA was not requested or run; the existing layout, component tests,
  type checks and production web build cover the Settings addition.

Final changed-file Biome command (25 files, passed with zero findings):

```sh
rtk proxy pnpm exec biome check server/scripts/search-bakeoff.ts server/src/agent/builtins/scout-sources.test.ts server/src/agent/builtins/scout-sources.ts server/src/agent/builtins/web-search.ts server/src/agent/run-role.ts server/src/jobs/ingest-job.test.ts server/src/jobs/ingest-job.ts server/src/jobs/source-preflight.test.ts server/src/jobs/source-preflight.ts server/src/routes/settings.test.ts server/src/routes/settings.ts server/src/search/backends.test.ts server/src/search/backends.ts server/src/workspaces/manager.test.ts server/src/workspaces/manager.ts shared/src/api.ts shared/src/frontmatter.test.ts shared/src/schemas.ts skills/.defaults-history.json web/src/components/Settings/IntegrationsSection.test.tsx web/src/components/Settings/IntegrationsSection.tsx server/src/search/budget.test.ts server/src/search/budget.ts server/src/search/options.test.ts server/src/search/options.ts
```

## Final re-bake-off table

| Subject | Slot | Exa usable | SearXNG usable | Exa cost |
| --- | --- | ---: | ---: | ---: |
| polymers | foundation | 3/10 | 2/10 | $0.007 |
| polymers | explainer | 5/10 | 1/10 | $0.007 |
| polymers | primary | 6/10 | 0/10 | $0.007 |
| polymers | expert | 2/10 | 1/10 | $0.007 |
| Hyderabad history | foundation | 2/10 | 1/10 | $0.007 |
| Hyderabad history | explainer | 2/10 | 1/10 | $0.007 |
| Hyderabad history | primary | 1/10 | 0/10 | $0.007 |
| Hyderabad history | expert | 2/10 | 1/10 | $0.007 |
| linear algebra | foundation | 6/10 | 2/10 | $0.007 |
| linear algebra | explainer | 8/10 | 2/10 | $0.007 |
| linear algebra | primary | 3/10 | 3/10 | $0.007 |
| linear algebra | expert | 6/10 | 2/10 | $0.007 |
| Stoic philosophy | foundation | 8/10 | 3/10 | $0.007 |
| Stoic philosophy | explainer | 9/10 | 2/10 | $0.007 |
| Stoic philosophy | primary | 4/10 | 0/10 | $0.007 |
| Stoic philosophy | expert | 1/10 | 3/10 | $0.007 |
| Indian parliamentary politics | foundation | 1/10 | 0/10 | $0.007 |
| Indian parliamentary politics | explainer | 2/10 | 2/10 | $0.007 |
| Indian parliamentary politics | primary | 3/10 | 2/10 | $0.007 |
| Indian parliamentary politics | expert | 2/10 | 2/10 | $0.007 |
| contract law basics | foundation | 5/10 | 0/10 | $0.007 |
| contract law basics | explainer | 3/10 | 0/10 | $0.007 |
| contract law basics | primary | 2/10 | 0/10 | $0.007 |
| contract law basics | expert | 0/10 | 1/10 | $0.007 |

## M13b measured result and fallback threshold

All 24 cases are judged under the same M13 accessibility/rank/recipe-fit/parse
rubric. Exa supplied **86/240 usable leads (35.8%)**, versus keyword SearXNG
**31/240 (12.9%)**. Exa won 19 cases, SearXNG 2, with 3 ties. There are 67 distinct
usable Exa URLs and 24 SearXNG URLs across the experiment. SearXNG added 28 usable
leads absent from Exa's returned URLs for the same query. This measures discovery
and access, not independently verified teaching claims.

| Slot | Exa usable / 60 | SearXNG usable / 60 | Original M13 Exa / SearXNG |
| --- | ---: | ---: | ---: |
| Foundation | 25 | 8 | 27 / 1 |
| Explainer | 29 | 8 | 28 / 8 |
| Primary | 19 | 5 | 21 / 2 |
| Expert | 13 | 10 | 27 / 8 |

The keyword SearXNG count rose from 19 to 31. Exa's total fell from 103 to 86;
its expert slot fell most, from 27 to 13. The required personal-site category can
narrow institutional/scholarly discovery (inference, not a controlled category
ablation). In the Indian-law expert case Exa yielded zero usable sources: a named
scholar's site did not resolve; other personal pages were advanced, thin or off-slot.
SearXNG found one accessible attributed legal explainer. The Stoic expert slot
was its other win, 3 usable versus Exa's 1. Keep fallback rather than claiming all
new options uniformly improve quality.

| N | Cases that would call fallback after full scouting | Added usable leads in those cases | Cases restored to at least N distinct usable URLs |
| --- | ---: | ---: | ---: |
| 1 | 1/24 | 1 | 1 |
| 2 | 4/24 | 4 | 1 |
| 3 | 11/24 | 12 | 7 |
| 4 | 15/24 | 18 | 6 |

**Retain N=3.** It calls fallback in 11/24 judged cases, adds 12 usable leads,
and restores 7 of those cases to at least three distinct usable sources. N=2
would call fallback only four times and miss eight of those extra usable leads;
N=4 calls four additional fallbacks and adds six more usable leads, while asking
for a higher sufficiency bar. Three provides a small pool of distinct source
candidates without always calling the fallback. The threshold is configurable and
capped by requested count. It is not proof that every concept is covered.

The native search first checks unique discovery leads (title/content/healthy
returned text); scout_sources then applies the same threshold to real rank/fetch
outcomes and returns fallbackLeads for ranking. A search-only caller cannot know
which snippets will survive fetch/ranking. This distinction matters because many
apparently healthy snippets and parses are off-topic or unusable.

Exa charged a reported **$0.168 for 24 completed searches** ($0.007 each), exactly
matching the restarted experiment's persisted budget ledger. Cost per usable Exa
lead is $0.00195; per distinct usable Exa URL $0.00251. First process issued 8
searches; resume issued 16, with saved results reused. This ledger starts at zero
for the isolated workspace and does not represent the owner's account-wide spend.
SearXNG has no measured per-query provider fee; extraction hosting is unmeasured.

| Provider / model | Attempted calls | Completed usage events | Fresh input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| openai-codex / gpt-6.1-sol | 25 | 24 | 609,713 | 26,766 | 0 | 0 |
| github-copilot, anthropic, openai API, OpenCode, other model providers | 0 | 0 | 0 | 0 | 0 | 0 |

One interrupted judge attempt has no final usage event; its token count is
**unknown**, not zero. Known totals include all 24 completed judgments; the attempt
remains in the request ledger. No completed judge error/retry was needed. Additional
subscription model charge $0; implementation-session tokens are not exposed by
this environment and are outside this script ledger. M13 previously reported
$0.184 Exa use; the two documented experiments/probes together total $0.352 of
known Exa cost, excluding any unrelated account activity.

Limits: a single subscription judge, bounded 5,000-character excerpts and this
self-hosted SearXNG engine configuration. The politics searches captured the
2026-10-05 UTC-midnight publication cutoff; final app code includes same-day
news through actual request time. This temporal correction was tested with fakes
without repeating paid searches. Recent category routes, finance,
related-page search and explicit deep-lite retry are unit-tested policy, not live winners
in this four-slot level-2 comparison. Engine/fetch/PDF warnings and individual
failures are retained. The original M13 table and conclusions above are preserved
as historical evidence; M13b's conditional routing replaces its always-merge policy.

## Owner follow-up — final routing and Exa skill corrections

Read `/path/to/studium/.agents/skills/build-with-exa/SKILL.md` and its search,
contents, models-and-modes and common-mistakes references. The original task
explicitly authorizes the slot/category/date/country/objective/content controls.
Requests now select one extraction view: concept-query highlights by default or
bounded text with section exclusions when requested. Removed redundant summary
synthesis, link extraction and highlight character options. Search contents remain
nested. Related-page requests use `/search` with the caller-supplied seed title/topic
as query and fast mode; `similarUrl` still validates the public seed. Deprecated
`/findSimilar`, includeText and excludeText are never sent.

Paper routing is **papers MCP → Exa publication**, including post-rank/fetch thin
results; SearXNG is never a paper fallback. The existing manager is reachable via
role/preflight dependencies, so the recipe-only escape hatch was unnecessary.
Use the verified aggregate `search_papers` schema across arXiv/PubMed/Semantic
Scholar/Crossref/OpenAlex (two results per source for a ten-result quota), with
individual search-tool support if aggregate is absent. Existing role MCP allowlists
and disabled tools remain enforced; DOI/PDF metadata is preserved, and DOI/open-access
lookup tools remain independently available. No Sci-Hub or download calls are made.

Video routing is **Exa → SearXNG youtube**. Exa uses includeDomains youtube.com;
both adapters/service and scout reject shorts, music.youtube.com, channel/playlist
pages, malformed IDs and empty titles. Only youtube.com/www.youtube.com /watch
URLs with 11-character IDs survive. Rank afterward. Valid video titles do not need
snippets; transcript/caption/duration availability stays unknown until ingestion.
D35, DEPLOY, default recipes, Settings and stop-notification copy now state this policy.

### Final follow-up validation

| Exact command (repo root unless noted) | Result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/search/ src/routes/settings.test.ts src/agent/builtins/scout-sources.test.ts src/agent/roles.test.ts src/jobs/source-preflight.test.ts src/jobs/ingest-job.test.ts src/workspaces/manager.test.ts` | 97 passed, 13 files |
| `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts` | 16 passed after final combined-provider threshold regression fix |
| `pnpm --filter @studium/server exec vitest run src/search/ src/agent/roles.test.ts` | 69 passed, 8 files (before final complete scoped run) |
| `pnpm --filter @studium/server exec vitest run src/workspaces/manager.test.ts -t 'notifies'` | 1 passed, 6 skipped |
| `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` | 7 passed, 1 file |
| `pnpm --filter @studium/web exec vitest run src/components/Settings/IntegrationsSection.test.tsx` | 3 passed, 1 file |
| `pnpm --filter @studium/server exec tsc --noEmit` | pass |
| `pnpm --filter @studium/web exec tsc --noEmit` | pass |
| `pnpm --filter @studium/shared exec tsc --noEmit` | pass |
| `pnpm --filter @studium/server exec tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --module ESNext --moduleResolution bundler --target ES2023 --lib ES2023 --esModuleInterop --types node scripts/search-bakeoff-specialized.ts scripts/search-bakeoff.ts` | pass |
| `pnpm --filter @studium/web build` | pass; existing large-chunk warning |

Final lint command: `rtk proxy pnpm exec biome check server/scripts/search-bakeoff.ts server/src/agent/builtins/scout-sources.test.ts server/src/agent/builtins/scout-sources.ts server/src/agent/builtins/web-search.ts server/src/agent/roles.test.ts server/src/agent/run-role.ts server/src/jobs/ingest-job.test.ts server/src/jobs/ingest-job.ts server/src/jobs/source-preflight.test.ts server/src/jobs/source-preflight.ts server/src/routes/settings.test.ts server/src/routes/settings.ts server/src/search/backends.test.ts server/src/search/backends.ts server/src/workspaces/manager.test.ts server/src/workspaces/manager.ts shared/src/api.ts shared/src/frontmatter.test.ts shared/src/schemas.ts skills/.defaults-history.json web/src/components/Settings/IntegrationsSection.test.tsx web/src/components/Settings/IntegrationsSection.tsx server/scripts/search-bakeoff-specialized.ts server/src/search/budget.test.ts server/src/search/budget.ts server/src/search/options.test.ts server/src/search/options.ts server/src/search/papers.test.ts server/src/search/papers.ts` — **29 files passed**.
`git diff --check` also passed. There
are **107 unique passing automated tests** (97 server, 7 shared, 3 web); reruns are
not counted twice. New fakes verify MCP-first routing, unavailable/error/thin MCP,
post-rank publication fallback cost, no SearXNG papers, strict video filtering,
youtube fallback query/engine, metadata-only videos, /search instead of findSimilar,
and direct scout access to the role-approved MCP manager. Combined MCP+Exa leads
are tracked together so a failed combined scout permits an explicit hard-gap retry;
its fixture makes the next MCP answer thin before asserting Exa deep-lite. Budget restart/month/cost
coverage from the first phase still passes. Temporary script/config command mistakes
were corrected without changing unrelated code; the standalone script tsc needs
--ignoreConfig and the server's ES2023 library set.

### Follow-up re-bake-off

From `server/`:
`node --env-file=/path/to/studium/.env --import tsx scripts/search-bakeoff.ts --specialized`

Isolated root: `/tmp/studium-m13b-specialized-UlET4P`. Rebuilt the report from saved
ranks with the same command plus that root as its final argument; this resume issued
zero searches or model calls. The original M13 and first M13b tables are preserved.

| Slot / concept | Exa usable | Papers MCP usable | SearXNG youtube usable | Exa cost |
| --- | ---: | ---: | ---: | ---: |
| paper / biodegradable polymers review | 10/10 | 4/6 | — | $0.007 |
| paper / RAG hallucination evaluation | 8/10 | 2/5 | — | $0.007 |
| paper / Indian Parliament accountability | 8/10 | 0/4 | — | $0.007 |
| paper / sparse matrix eigenvalue methods | 10/10 | 2/6 | — | $0.007 |
| video / polymer structure/polymerisation | 10/10 | — | 2/10 | $0.007 |
| video / linear transformations/eigenvectors | 5/8 | — | 4/10 | $0.007 |
| video / Stoic ethics | 9/10 | — | 4/10 | $0.007 |
| paper total | **36/40** | **8/21** | — | **$0.028** |
| video total | **24/28** | — | **10/30** | **$0.021** |

Usable here is discovery rank >=3 plus topic/type fit; papers need meaningful
abstract/excerpt metadata, videos need valid watch URLs/titles. Full paper text,
open-access availability and video transcripts were not verified. These counts
must not be combined with the first fetched-text 86/240 vs 31/240 table. One
subscription judge, bounded snippets, two-per-source MCP quota and upstream failures
limit generalization. All four MCP searches warned about unavailable sources; the
response probe identified Semantic Scholar HTTP 429. SearXNG warned about unavailable
engines, although its youtube engine returned ten candidates per query.

N=3 remains appropriate as a configurable default: three of four MCP cases fell
below three useful ranked papers, triggering Exa; the remaining case could stay
MCP-only. All three Exa video cases exceeded three ranked candidates, so fallback
was unnecessary for them in this sample. The two discarded-title-only SearXNG
polymers candidates were reinstated from saved ranks; no fresh judge calls were
needed. Discovery counts alone would have concealed poor paper fit, which is why
post-rank/fetch fallback is implemented.

### Follow-up usage and spend

Exa: **7 searches, $0.049**, matching the workspace's persisted monthly ledger.
Papers MCP: **4 benchmark aggregate searches + 1 response-shape probe**; no download
or DOI/open-access lookup calls. SearXNG: **3 youtube searches**, zero paper searches.
MCP/SearXNG expose no dollar-cost report; no per-query fee was measured, and hosting
cost is unmeasured. Metadata listing and report-only resume made no Exa/model calls.

| Provider / model | Follow-up calls | Usage results | Fresh input | Output | Cache read/write |
| --- | ---: | ---: | ---: | ---: | ---: |
| openai-codex / gpt-6.1-sol | 7 | 7 | 34,507 | 5,027 | 0 / 0 |
| github-copilot, anthropic, OpenAI API, OpenCode, other model providers | 0 | 0 | 0 | 0 | 0 / 0 |

M13b's two isolated experiments total **31 Exa searches / $0.217**, and model usage
is **32 attempted calls / 31 completed results**, 644,220 known fresh input and
31,793 output tokens. The first-phase interrupted attempt remains unknown, not zero.
Prior M13 reported $0.184; all documented M13+M13b spend totals **$0.401 known**,
excluding the owner's unrelated probes/account activity. Subscription additional
model charge is $0; implementation-session tokens remain unavailable.

## Not done / open questions

No requested item is blocked. No commit/push/branch change, production/config write,
AGENT_MEMORY edit or data modification occurred. The follow-up is a metadata
comparison and does not assert paper full-text/open-access or video transcript
availability. No browser visual QA ran. Original benchmark expert/date limitations
and the interrupted judge's unknown usage remain documented. Papers MCP bridge
access fitted the actual code, so no file:line implementation skip was needed.

## Five-line log entry

2026-10-05 · M13b + owner follow-up · local codex/m13b implementer; no delegation/commit/push/data edits.
Official Exa skill applied: one extraction view, /search related-page retrieval, no deprecated parameters.
Papers MCP first → Exa publication, never SearXNG; videos Exa youtube.com first → SearXNG youtube with strict watch/title filtering.
107 scoped tests pass; server/web/shared tsc, script tsc, web build and final Biome pass; persisted $8/$9.50 guard remains.
M13b Exa $0.217/31 searches; follow-up papers 36 Exa/8 MCP, videos 24 Exa/10 SearXNG; full-text/transcripts and one prior judge's tokens unknown.
