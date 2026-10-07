# M13 implementation report

Approved scope: Parts 1–4 of `2026-10-05-m13-search-backends.md`, implemented directly on codex/m13. No delegation, commits, production writes or credential-file changes.

## Implementation sequence

1. Shared backend adapters and recipe-slot routing; private workspace query cache, pacing and failure guard; web_search/scout_sources integration; separate Exa job accounting and fake-network tests.
2. Twenty-four six-subject × four-slot queries; top-ten search leads from both backends; independent public extraction and subscription LLM fit/rank assessment; checkpoint every result/cost, document measured routing.
3. Four tolerant subject values, source recipes, teaching guides, contested-topic checker rules, D35 and default-skill hashes.
4. Confined, locked refresh-source job and source/set routes; preserve source identity and matching section anchors, skip missing originals/blocked fetches, report parse quality; UI controls and completion summary.

## Setup

`pnpm install --frozen-lockfile --prefer-offline` passed. Initial worktree clean; branch codex/m13.

## Part 1 — search backends

Added normalized Exa/SearXNG adapters, recipe-slot routing, canonical merging, 15-minute private workspace query cache, serialized backend pacing (SearXNG 1.5 seconds, Exa 150 ms) and a three-consecutive-failure guard without automatic search retries. web_search and scout_sources share a job-scoped service; existing MCP tools remain compatible. Exa page text is bounded, parse-scored and wrapped as untrusted discovery data; evidence fetching still uses the public extraction pipeline. Request counts and API-returned cost are separate optional job usage fields, persisted through history and shown alongside tokens.

- `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts src/agent/builtins/scout-sources.test.ts src/agent/roles.test.ts src/jobs/runner.test.ts src/jobs/log.test.ts`: 50 passed.
- Added Exa-history round-trip regression and corrected cache TTL: `pnpm --filter @studium/server exec vitest run src/jobs/log.test.ts src/search/backends.test.ts`: 17 passed.
- `pnpm --filter @studium/web exec vitest run src/lib/job-format.test.ts`: 5 passed.
- Server `tsc --noEmit`: passed.
- Current [Exa API documentation](https://exa.ai/docs/reference/search) lists auto search and publication categories. Adapter uses these documented options; legacy neural and findSimilar probes both succeeded, reported $0.004 each ($0.008 total). No keys printed.

## Part 2 — experiment

`server/scripts/search-bakeoff.ts` implements 24 queries across six subjects and four recipe slots, top ten per backend, canonical independent M12 fetching, parse health, subscription-model sources.rank fallback judgment plus recipe fit/accessibility, uniqueness and cost per usable source. Checkpoints every search and fetch batch, with provider ledgers and failure guards. The completed evidence is in `/tmp/studium-m13-bakeoff-AJwCX6` and `2026-10-05-m13-search-bakeoff.md`. All 24 cases have model rankings. Part 2 was started before Part 3; its long-running remote fetching continued during Parts 3–4, and final defaults were checked against the completed results.

## Part 3 — subjects and contested topics

Added philosophy/politics/law/economics to PlanSubject while preserving unknown→general parsing; source recipes and four teaching guides follow the existing section shape with explicitly style-only excerpts. Plan-set chooses these subjects. Teaching.md and its shipped copy state the contested-topic rule; fact-check and the independent checker task explicitly make its violations blockers for the four subjects. Regenerated default skill history.

- `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts`: 6 passed.
- `pnpm --filter @studium/server exec vitest run src/ingest/refresh.test.ts src/routes/library.test.ts src/jobs/draft-job.test.ts src/jobs/plan-job.test.ts`: 55 passed (includes existing draft/plan compatibility).

## Part 4 — source refresh

Added non-model `refresh-source` job, source/set POST routes, duplicate-request coalescing, missing-upload-original checks, blocked-host memory, lower-quality retention, per-file locks, atomic writes with rollback on failure, canonical path confinement and librarian commits. Matching section locators persist in parsed Markdown; renamed/moved duplicate sections retain anchors and missing sections are reported. Source metadata shows quality before/after and disappeared anchors. Library filtered by set exposes Refresh all sources; source detail exposes Refresh; completion toast aggregates outcomes and links to details. Extraction uses no AI, so it is available when AI is disabled.

Live trial uses `/tmp/studium-m13-refresh-OZZnvn`: production data was read only, originals copied into scratch only. Full before/after table is in `2026-10-05-m13-refresh-trial.md`. No model/Exa usage for refresh.

- Scoped required server run (`src/ingest/`, `src/search/`, `src/tree/` and touched test modules): 374 passed, 1 timeout at `server/src/tree/init.test.ts:88` (5 seconds), with cleanup ENOTEMPTY after the timeout. Targeted rerun recorded below; no unrelated implementation changes.
- `pnpm --filter @studium/web exec vitest run src/components/Activity/JobToasts.test.tsx src/components/Activity/ActivityPanelContent.test.tsx src/lib/job-format.test.ts src/api/queries.test.tsx`: 11 passed.

## Final results

All four parts implemented. Exa-first routing is retained for the four measured source-description slots; no unsupported changes to paper/video/recent policy. The normalized interface works without Exa, through SearXNG alone. Cached calls do not increase job request/cost totals; missing provider cost is explicitly warned about. web_search and scout_sources share the same job failure guard and cache. D35 records the final behavior.

| Subject (four slots, top ten each) | Exa usable / 40 | SearXNG usable / 40 |
| --- | ---: | ---: |
| Polymers | 20 | 8 |
| Hyderabad history | 10 | 0 |
| Linear algebra | 27 | 6 |
| Stoic philosophy | 26 | 5 |
| Indian parliamentary politics | 11 | 0 |
| Contract law | 9 | 0 |
| Total | 103 / 240 | 19 / 240 |

Per-slot/query winners, all 24 queries, 480 scored candidates and short quoted examples are in [the bakeoff](2026-10-05-m13-search-bakeoff.md). Exa won 22 cases; two ties. Cost per usable Exa lead $0.00163. Unique usable leads for the same query: Exa 99, SearXNG 15; distinct usable URLs across the experiment: 73 and 16. The identical long natural-language queries favor Exa's source-description workflow; keyword-optimized SearXNG performance was not measured. A single bounded-excerpt model judge does not prove factual accuracy. Contract-law primary evidence had no usable result from either backend.

[Refresh trial](2026-10-05-m13-refresh-trial.md): PCA 65→100; SVD 65→100; LibreTexts polymers 93→95; AKDN Hyderabad 95→100; OpenStax physics 99→100. Colorado 89→89, Computer History 95→95 and two ASML entries 100→100 also refreshed. Strang 0→0 skipped because the uploaded original is missing. Nine librarian commits were made **only in the temporary copy**. Matching locators persisted; disappeared locators are listed in the trial. Production data was read only.

### External usage

| Provider | Requests/calls | Spend | Fresh tokens | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Exa bakeoff | 24 | $0.168 | — | — | — | — |
| Exa compatibility/text probes | 4 | $0.016 | — | — | — | — |
| Exa total | 28 | $0.184 | — | — | — | — |
| openai-codex / gpt-6.1-sol | 31 | $0 additional, subscription | 578183 | 26560 | 0 | 0 |
| github-copilot | 0 | $0 | 0 | 0 | 0 | 0 |
| anthropic | 0 | $0 | 0 | 0 | 0 | 0 |
| openai API / other model providers | 0 | $0 | 0 | 0 | 0 | 0 |

Model usage includes seven failed/incomplete judgment attempts; two Stoic cases recovered in a sequential resume using saved evidence, without new searches. Refresh used no models or Exa. Extraction-service hosting costs were not measured. Credentials were supplied only to script processes with `--env-file` and were never printed.

### Exact final verification

No full suite was run. Earlier focused checks are recorded above; the following cover the final changes and required areas:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Passed before implementation/tests |
| `pnpm --filter @studium/server exec vitest run src/ingest/ src/search/ src/tree/ src/jobs/draft-job.test.ts src/jobs/plan-job.test.ts src/jobs/log.test.ts src/jobs/runner.test.ts src/routes/library.test.ts src/routes/library-retry.test.ts src/agent/roles.test.ts src/agent/builtins/scout-sources.test.ts` | 374 passed, 1 timeout; 41 files |
| `pnpm --filter @studium/server exec vitest run src/tree/init.test.ts -t 'fills missing default skills but preserves user-edited skill files'` | 1 passed, 7 skipped; resolves timeout |
| `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts src/jobs/refresh-source-job.test.ts` | 27 passed |
| `pnpm --filter @studium/server exec vitest run src/ingest/library.test.ts src/ingest/refresh.test.ts src/jobs/refresh-source-job.test.ts` | 17 passed |
| `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts src/agent/roles.test.ts src/agent/builtins/scout-sources.test.ts` | 25 passed |
| `pnpm --filter @studium/server exec vitest run src/search/backends.test.ts` | Final adapter/seed/cost checks: 6 passed |
| `pnpm --filter @studium/web exec vitest run src/components/Activity/JobToasts.test.tsx src/components/Activity/ActivityPanelContent.test.tsx src/lib/job-format.test.ts src/api/queries.test.tsx src/pages/LibraryPage.test.tsx src/pages/LibrarySourcePage.test.tsx` | 21 passed, 6 files |
| `pnpm --filter @studium/web exec vitest run src/components/Activity/JobToasts.test.tsx` | Final fixture/identical-summary checks: 3 passed |
| `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` | 6 passed |
| `pnpm --filter @studium/server exec tsc --noEmit` | Passed |
| `pnpm --filter @studium/web exec tsc --noEmit` | Passed |
| `pnpm --filter @studium/shared exec tsc --noEmit` | Passed |
| `pnpm --filter @studium/web build` | Passed; existing >500kB chunk warning |
| `node scripts/skill-history.mjs` | Regenerated default hashes; verified teaching copies identical |
| `rtk proxy pnpm exec biome check <all changed files listed below>` | Passed: 37 supported files checked, 51 paths supplied |
| `git diff --check` | Passed |

The one broad-run timeout was `server/src/tree/init.test.ts:88`, its default 5-second budget, followed by cleanup ENOTEMPTY. The exact targeted test passed without unrelated implementation or timeout changes. An initial new checker fixture failed because its fake rewrite did not reset draft status; corrected, all draft tests passed. A toast fixture initially failed TypeScript's partial-object assertion; completed the typed fixture, final web types passed. Initial formatting checks found only formatting differences, fixed on owned files.

Browser verification used the built web app, local fake API/SSE, actual pointer/keyboard input and a separate owned Chrome profile per viewport/theme. 390×900 and 1440×900, light/dark: eight source/set refresh requests; correct set payload; Refresh all absent without selected set; completion summary and quality before/after; no horizontal overflow or JS exceptions; mobile Refresh target 44px. Service-worker registration was blocked in the harness after repeated full navigations exhausted old SSE/HTTP connections; PWA/offline behavior is not claimed tested. Screenshots and results:

- `/tmp/studium-m13-browser-cOZdou` — phone/light.
- `/tmp/studium-m13-browser-nhgRiH` — phone/dark.
- `/tmp/studium-m13-browser-rEXX7c` — desktop/light.
- `/tmp/studium-m13-browser-N5LuIh` — desktop/dark.

Exact browser commands: `node /tmp/studium-m13-browser.mjs 390 light`, `node /tmp/studium-m13-browser.mjs 390 dark`, `node /tmp/studium-m13-browser.mjs 1440 light`, `node /tmp/studium-m13-browser.mjs 1440 dark`; four passed. Only owned mock servers and Chrome processes were stopped.

Live script commands (from server/): `node --env-file=/path/to/studium/.env --import tsx scripts/search-bakeoff.ts`, resumed with `/tmp/studium-m13-bakeoff-AJwCX6`; `node --env-file=/path/to/studium/.env --import tsx scripts/source-refresh-trial.ts /path/to/studium/data/users/<username>`. Evidence and usage remain in the temp directories for review.

### Deviations and open limits

- Current documented Exa API uses `auto` and `publication`; mapped the requested neural-style search/research-paper intent to those values. Legacy neural and findSimilar live probes succeeded. [Official search reference](https://exa.ai/docs/reference/search), [rate-limit reference](https://exa.ai/docs/admin/billing).
- Part 2 remote evaluation overlapped later implementation after Part 2 was started; final measurements and defaults were completed before reporting.
- No papers/video/recent comparative bakeoff, keyword-optimized SearXNG comparison, or real model-authored contested chapter acceptance run; those routes remain policy defaults and subject blockers have a fake-role regression.
- Refresh preserves the existing source summary/title/authors/credibility and regenerates parsed content/section metadata/TOC. It does not spend model calls to rewrite the existing summary. Skipped/unchanged reasons are in live Activity/job results; successful last-refresh quality metadata persists in source.md. Structured per-source refresh results are not reconstructed from old Markdown job history after a server restart.
- Matching locators refer to the existing citation/passage contract. Truly disappeared locators remain in notes and are reported, never silently rewritten. Extraction health never certifies truth.
- No commits, pushes, branch changes, dependency additions or edits to AGENT_MEMORY.md, .env*, .claude/, reference/ or production data. No blocking item remains.

## Changed files

- [docs/TEACHING.md](../../docs/TEACHING.md): Contested-topic teaching rules.
- [docs/decisions/LOG.md](../../docs/decisions/LOG.md): D35: routing, accounting, subject fairness and refresh.
- [docs/plans/2026-10-05-m13-refresh-trial.md](../../docs/plans/2026-10-05-m13-refresh-trial.md): Ten-source scratch-copy before/after evidence.
- [docs/plans/2026-10-05-m13-search-backends-report.md](../../docs/plans/2026-10-05-m13-search-backends-report.md): Implementation, file catalog, verification, usage and limitations.
- [docs/plans/2026-10-05-m13-search-bakeoff.md](../../docs/plans/2026-10-05-m13-search-bakeoff.md): 24 queries, 480 judgments, winners, quotes and usage.
- [server/scripts/search-bakeoff.ts](../../server/scripts/search-bakeoff.ts): Resumable isolated real search/extract/subscription-rank experiment.
- [server/scripts/source-refresh-trial.ts](../../server/scripts/source-refresh-trial.ts): Read-only production selection and scratch-copy refresh trial.
- [server/src/agent/builtins/scout-sources.ts](../../server/src/agent/builtins/scout-sources.ts): Native search discovery mode before candidate ranking.
- [server/src/agent/builtins/web-search.ts](../../server/src/agent/builtins/web-search.ts): Native bounded untrusted search tool.
- [server/src/agent/roles.ts](../../server/src/agent/roles.ts): Research-role web_search allowlist.
- [server/src/agent/run-role.ts](../../server/src/agent/run-role.ts): Shared job search service and Exa usage callback.
- [server/src/ingest/library.ts](../../server/src/ingest/library.ts): Expose validated refresh metadata/quality.
- [server/src/ingest/refresh.test.ts](../../server/src/ingest/refresh.test.ts): In-place identity/locators/commit, safe skips and concurrency tests.
- [server/src/ingest/refresh.ts](../../server/src/ingest/refresh.ts): Confined locked M12 re-extraction with retention and rollback.
- [server/src/ingest/sections.ts](../../server/src/ingest/sections.ts): Preserve section locators across matching refreshed content.
- [server/src/jobs/draft-job.test.ts](../../server/src/jobs/draft-job.test.ts): Contested politics blocker/independent checker regression.
- [server/src/jobs/draft-job.ts](../../server/src/jobs/draft-job.ts): Explicit subject-aware contested-topic checker blockers.
- [server/src/jobs/log.test.ts](../../server/src/jobs/log.test.ts): Separate Exa history round-trip regression.
- [server/src/jobs/log.ts](../../server/src/jobs/log.ts): Persist and parse Exa accounting.
- [server/src/jobs/refresh-source-job.test.ts](../../server/src/jobs/refresh-source-job.test.ts): Set aggregation, failure continuation and cancellation tests.
- [server/src/jobs/refresh-source-job.ts](../../server/src/jobs/refresh-source-job.ts): Non-model single/set refresh handler.
- [server/src/jobs/runner.ts](../../server/src/jobs/runner.ts): Aggregate Exa usage; non-model refresh-source kind.
- [server/src/routes/library.test.ts](../../server/src/routes/library.test.ts): Source/set refresh routes, duplicate coalescing and validation.
- [server/src/routes/library.ts](../../server/src/routes/library.ts): Source and selected-set POST refresh endpoints.
- [server/src/search/backends.test.ts](../../server/src/search/backends.test.ts): Fake adapters, routing, cost/cache, pacing/guards and public URL tests.
- [server/src/search/backends.ts](../../server/src/search/backends.ts): Exa/SearXNG adapters, routing, dedupe, query cache and pacing.
- [server/src/workspaces/manager.ts](../../server/src/workspaces/manager.ts): Register refresh job with existing extractors.
- [shared/src/api.ts](../../shared/src/api.ts): Refresh job/results/source metadata and Exa usage contracts.
- [shared/src/frontmatter.test.ts](../../shared/src/frontmatter.test.ts): Four subjects and tolerant unknown parsing regression.
- [shared/src/schemas.ts](../../shared/src/schemas.ts): Add philosophy, politics, law and economics.
- [skills/.defaults-history.json](../../skills/.defaults-history.json): New default skill hashes.
- [skills/draft-chapter/references/subject-economics.md](../../skills/draft-chapter/references/subject-economics.md): Economics teaching skeleton, pitfalls and style-only excerpt.
- [skills/draft-chapter/references/subject-law.md](../../skills/draft-chapter/references/subject-law.md): Law teaching skeleton, pitfalls and style-only excerpt.
- [skills/draft-chapter/references/subject-philosophy.md](../../skills/draft-chapter/references/subject-philosophy.md): Philosophy teaching skeleton, pitfalls and style-only excerpt.
- [skills/draft-chapter/references/subject-politics.md](../../skills/draft-chapter/references/subject-politics.md): Politics teaching skeleton, pitfalls and style-only excerpt.
- [skills/fact-check/SKILL.md](../../skills/fact-check/SKILL.md): Contested-topic violations are blockers.
- [skills/find-sources/SKILL.md](../../skills/find-sources/SKILL.md): Prefer native web_search with MCP fallback.
- [skills/find-sources/references/recipes.md](../../skills/find-sources/references/recipes.md): Four subject recipes and backend slot/domain guidance.
- [skills/note-authoring/references/teaching.md](../../skills/note-authoring/references/teaching.md): Shipped teaching copy kept identical.
- [skills/plan-set/SKILL.md](../../skills/plan-set/SKILL.md): Choose new subject values.
- [web/src/api/client.ts](../../web/src/api/client.ts): Source and set refresh client methods.
- [web/src/api/queries.test.tsx](../../web/src/api/queries.test.tsx): Refresh completion invalidates source/parsed queries.
- [web/src/api/queries.ts](../../web/src/api/queries.ts): Refresh mutation hook and SSE invalidation.
- [web/src/components/Activity/ActivityPanelContent.tsx](../../web/src/components/Activity/ActivityPanelContent.tsx): Refresh icon/outcomes/quality plus Exa usage.
- [web/src/components/Activity/JobToasts.test.tsx](../../web/src/components/Activity/JobToasts.test.tsx): Refresh summaries and repeated-identical-summary regressions.
- [web/src/components/Activity/JobToasts.tsx](../../web/src/components/Activity/JobToasts.tsx): Aggregate refresh toast; deduplicate message-based toast IDs.
- [web/src/lib/job-format.ts](../../web/src/lib/job-format.ts): Display Exa request/cost separately from token usage.
- [web/src/pages/LibraryPage.test.tsx](../../web/src/pages/LibraryPage.test.tsx): Selected-set refresh control interaction.
- [web/src/pages/LibraryPage.tsx](../../web/src/pages/LibraryPage.tsx): Refresh all sources for selected set.
- [web/src/pages/LibrarySourcePage.test.tsx](../../web/src/pages/LibrarySourcePage.test.tsx): Source refresh interaction.
- [web/src/pages/LibrarySourcePage.tsx](../../web/src/pages/LibrarySourcePage.tsx): Refresh control, extraction quality and last result.

## Five-line memory entry (for the orchestrator; memory file untouched)

2026-10-05 M13: Exa/SearXNG search, four subjects and source/set refresh implemented on codex/m13; no commit.
server/search + agent tools: slot routing, 15-minute cache, pacing/failure guard and separate Exa job/history usage; 103 vs 19 usable leads.
shared/schemas + skills + teaching + draft checker: philosophy/politics/law/economics and attributed/datable contested-topic blockers; hashes updated.
refresh helper/job/routes + Library/Activity: safe in-place M12 extraction, matching locators and reported losses; trial 5 improved, 4 same, 1 missing-original skip.
Gotchas/open: long-query comparison only; papers/video/recent unmeasured; retained summaries and live-only detailed skip results; Exa $0.184, model usage in report.
