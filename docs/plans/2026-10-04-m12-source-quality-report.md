# M12 implementation report

## Phase 1 — measurement and fetch honesty

Implemented pure parse-health scoring and optional `quality` source frontmatter (legacy sources remain valid); read-only audit script; bounded secret-redacted job-log reasons with history round-trip; image URL/file-page rejection; Firecrawl + direct failure reporting, instance-scoped blocked-host memory, and one 429 retry honoring Retry-After up to 10 seconds.

- Required install: `pnpm install --frozen-lockfile --prefer-offline` passed.
- `pnpm --filter @studium/server exec vitest run src/ingest/quality.test.ts src/agent/builtins/web-fetch.test.ts src/agent/builtins/add-source.test.ts src/jobs/log.test.ts`: 29 passed. Initial run: 28 passed / 1 failed due to fake bearer token colliding with fixture commit SHA; test data corrected.
- `pnpm --filter @studium/server exec tsx scripts/source-audit.ts "$(cat /tmp/studium-m12-root)" ../docs/plans/2026-10-04-m12-source-audit.md`: passed. Copy: `/tmp/studium-m12-3_d5cf73/tree`, excludes git, sessions/cache, original downloads and PDFs. Production data remains read-only.
- Baseline: empty Strang source 0, SVD 40 (math soup + truncation), PCA 65 (math soup), Colorado 89, LibreTexts polymer 93. Parse health does not measure factual authority, pedagogical depth, or coverage.

Remaining phases and live comparisons are in progress. No model calls made yet (all provider usage zero).

## Phase 2 — structure-preserving extraction

Implemented TeX preservation for annotations/MathJax/Wikipedia fallbacks, GFM tables, language fences, captions/alt; shared deterministic section anchors and extractive summaries (stored in sections.json and used in retrieval); H2-aware splitting; explicit wiki/arXiv/JS strategies; one low-quality Firecrawl → direct retry choosing the better parse; arXiv HTML → PDF fallback.

- `pnpm --filter @studium/server exec vitest run src/ingest/ src/search/ src/tree/ src/agent/builtins/web-fetch.test.ts src/agent/builtins/add-source.test.ts src/jobs/log.test.ts`: 290 passed after fixing a JavaScript replacement-string `$$` escape and preserving code languages before Readability strips classes; updated arXiv fallback test for the new HTML-first contract.
- `pnpm --filter @studium/server exec tsc --noEmit`: passed.
- Real re-import command: from server, `node --env-file=/path/to/studium/.env --import tsx scripts/source-reimport.ts "$(cat /tmp/studium-m12-root)" ../docs/plans/2026-10-04-m12-source-reimport.md`. Ten sources attempted; three improved (polymer 93→95, AKDN 95→100, OpenStax 99→100). Full before/after/error table in source-reimport.md. No model usage. Sources blocked by remote services retain the old parse.
- Registry limitation: the existing wiki API handles HTML; no unsupported print URL is invented. The explicit Stack Overflow view uses the site's supported answer-order parameter. Section summaries are extractive (zero tokens), not model-generated.

## Resume after host interruption

The repo edits and Phase 1–2 reports survived; `/tmp/studium-m12-*` and the incomplete live scouting process did not. Recreated a read-only-source copy at `/tmp/studium-m12-rorqq997/tree`. The interrupted scout reached the polymers baseline but recorded no provider usage in the saved report; any in-flight provider consumption from that lost process is unknown, not asserted zero. The restarted comparison checkpoints usage every 30 seconds.

## Phase 3 — recipes, scouting and domain learning

Implemented subject × level recipes; 10–20 candidate scouting guidance per slot; `scout_sources` (LLM-ranked candidates, optional shadow classifier, canonicalization, top-candidate fetch, parse-health and thin-page rejection); domain outcome hints from blocked/low-quality imports and citations in checked chapters. Added `sources.rank` and `video.useful` in shadow. Classifier off/shadow preserves the caller LLM's reasoned ranking. No on-mode promotion without known-outcome calibration.

- `pnpm --filter @studium/server exec vitest run src/agent/builtins/scout-sources.test.ts src/agent/classifier.test.ts src/agent/roles.test.ts src/jobs/ingest-job.test.ts src/jobs/plan-job.test.ts src/ingest/ids.test.ts src/jobs/draft-job.test.ts src/search/coverage.test.ts src/course/build.test.ts`: 108 passed.
- `pnpm --filter @studium/server exec tsc --noEmit`: passed.
- The real comparison on polymers, Hyderabad history and linear algebra is running via `node --env-file=/path/to/studium/.env --import tsx scripts/source-scout-eval.ts "$(cat /tmp/studium-m12-root)"` from server. Results/usage checkpoint into source-comparison.md. No key values are printed.
- Cache-path mismatch resolved: `server/src/tree/paths.ts:68` forbids agent access to `.cache`; telemetry uses a private no-follow, confined, bounded cache reader instead of changing that guard.
- Earlier new-test failures were an assertion expecting unescaped JSON and use of the agent path resolver for private cache reads. Fixed and rerun. An existing draft fixture now includes eigenvectors to fully cover its new two-concept preflight scope.

## Phase 4 — coverage before drafting

Implemented scope-concept extraction, FTS section matching, persisted covered/total + weakest-concept diagnostics, a read-only Outliner gap-scouting pass and inline Librarian ingestion before each new draft. No enqueue-and-wait occurs inside a runner slot; the existing approval kickoff still settles its source imports first. Course API rows expose optional evidence diagnostics and the UI shows a semantic meter with counts/gaps in text. Rewrites preserve existing citations/media and do not automatically expand their source scope.

- `pnpm --filter @studium/server exec vitest run src/agent/video-evidence.test.ts src/jobs/source-preflight.test.ts src/search/coverage.test.ts src/jobs/draft-job.test.ts src/course/build.test.ts src/inbox/plan-kickoffs.test.ts`: 38 passed.
- `pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx`: 8 passed. Initial 7 pass / 1 failure was use of an unavailable jest-dom assertion, corrected to the repo's native assertion style.
- `pnpm --filter @studium/server exec tsc --noEmit`, `pnpm --filter @studium/web exec tsc --noEmit`, `pnpm --filter @studium/shared exec tsc --noEmit`: all passed.
- Coverage is explicitly lexical concept matching, not factual verification. The checker still runs independently. Evidence diagnostics are optional, bounded private cache data; reads never mutate curriculum/notes.

## Track V — implementation checkpoint

Rules and planner recipes now propose 1–3 useful named-educator/demo videos, prefer manual captions, and mark unknown length/caption metadata honestly. Timestamped transcript sections participate in FTS retrieval. Drafter instructions require adjacent bounded moments, real tN citations and no decorative opening video. Watch-only videos are separated from citable evidence. New checker evidence checks block absent transcripts, fabricated/out-of-section times, missing adjacent citations and >180-second moments; semantic mismatch and suitable unused videos are passed to the independent checker as review hints. `video.useful` remains shadow pending calibration.

Three focused video-evidence tests pass as part of the 38-test command above. Live video proposals/moments and the polymers redraft remain in progress. Default skill hashes updated with `node scripts/skill-history.mjs`. D34 added.

## Final results — supersede preliminary metrics above

Phases 1–4 and Track V implementation are complete within the limitations below. All changes remain uncommitted on `codex/m12`. No production study files, credentials, memory, reference checkout or branch state were changed. Live app jobs made normal snapshots only inside isolated temporary study trees. No dependencies or services were added.

### Audit and re-import

The corrected baseline SVD score is **65**, not the preliminary 40: its “Truncated singular value decomposition” link is not a truncation marker. Valid `$...$`/`$$...$$` TeX is excluded from soup detection. The final ten-source re-import improved **5** parses, superseding the first three-improvement run.

| Source | Before | After |
| --- | ---: | ---: |
| Strang (no parsed text or URL) | 0 | 0 |
| Wikipedia SVD | 65 | 100 |
| Wikipedia PCA | 65 | 100 |
| Colorado | 89 | 89 |
| LibreTexts polymer | 93 | 95 |
| AKDN Hyderabad restoration | 95 | 100 |
| Computer History Museum | 95 | 95 |
| OpenStax physics | 99 | 100 |
| ASML microchip manufacture | 100 | 100 |
| ASML lithography | 100 | 100 |

Final audit/re-import evidence: `source-audit.md`, `source-reimport.md`; isolated re-import tree `/tmp/studium-m12-audit-20yza7xt/tree`. Parse health alone cannot detect an empty book registration's missing URL, transcript semantic errors, factual reliability, or insufficient topic depth.

### Three-subject comparison

Real application Outliner runs used the updated recipes and tools on `/tmp/studium-m12-scout-Z0cqjC`; fresh fetches independently scored their proposed URLs. Full source IDs/URLs/reasons appear in `source-comparison.md` and `source-proposed-scores.md`.

| Subject | Sources today / parse health | Proposed additions / fresh parse health |
| --- | --- | --- |
| Polymers | OpenStax ch20 100; Wikipedia Polymer 100; LibreTexts Schaller 93 | OpenStax early atomic theory 100; PSLC Macrogalleria 100 |
| Hyderabad history | Nine imported sources: Incredible India, UNESCO ×2, LSE, Cambridge ×2, Wikipedia ×2 all 100; AKDN 95 | Wikipedia Hyderabad 100; independent 1948/community/museum evidence remains missing |
| Linear algebra | Strang 0/no parse; Wikipedia SVD 65; Wikipedia PCA 65 | NumPy reference 100; 3Blue1Brown transformations lesson 100; MIT 18.06 course 100; individual 3Blue1Brown video transcript blocked, watch-only score 0 |

Each case requested three ten-result searches. Search results were repetitive/irrelevant: the requested 10–20 **viable** candidates per slot was not attained. Hyderabad ranked ten leads through `scout_sources`; polymer/linear-algebra proposals candidly report that ranked scouting was incomplete. Proposed pages are supplements, not proof that recipe slots are filled: the Macrogalleria instructional subpages and MIT exercises were not inspected. No papers were proposed at beginner level.

### Polymers redraft

`node --env-file=/path/to/studium/.env --import tsx scripts/source-redraft-eval.ts "$(cat /tmp/studium-m12-root)"` (from server) completed. Original `polymers/notes/01-polymers-from-carbon-bonds-to-everyday.md`: **5** `Uncertain:` instances. New isolated note `/tmp/studium-m12-redraft-a01buk/tree/polymers/notes/03-polymers-from-carbon-bonds-to-everyday.md`: **0**, status **checked** after the independent checker. It used the same three registered polymer sources; no new video moment was forced. Lexical preflight found 9/9 scoped phrases, so this run did not exercise gap expansion. This is an uncertainty-count improvement, not a controlled proof of causal source-quality improvement. `source-preflight.test.ts` verifies gap scouting and transcript-engine forwarding separately. Full result: `2026-10-04-m12-redraft.md`.

### Track V results

The real planner proposed only the individual 3Blue1Brown video `https://www.youtube.com/watch?v=kYB8IZa5AuE` for moving grid/basis-vector teaching. Its transcript was blocked, so no claim citation or invented timestamp was produced. Polymer demo and Hyderabad institutional walkthrough searches found no verified individual candidate. Manual-caption preference and 5–30-minute fit remain guidance with metadata explicitly unknown.

An isolated live drafter probe used the already registered conditional-memory video `https://www.youtube.com/watch?v=7CeF90OfTi4`, selected through ranked transcript passages. It chose **159–216 seconds** after the supporting multi-head hash paragraph, citing `[^src:lib-behaviors-deepseek-conditional-memory-via#t159]`; exact verified excerpt: **“we send it through multiple hash functions”**. It explains the retrieval/gating sequence without claiming unseen animation. Structural review: no blockers/hints. This is a moment-selection probe, not a full independently checked chapter. Details and complete prose: `2026-10-04-m12-video.md`.

Probe command (from server): `node --env-file=/path/to/studium/.env --import tsx scripts/source-video-eval.ts /tmp/studium-m12-rorqq997/tree`. The first probe failed exact-quote verification; the second saved a valid quote but used the wrong set slug during review. Corrected the slug to `deepseek-ngram` and replayed the saved response with `/tmp/studium-m12-video-KX8Rpf` as the third argument, making no further model request. Both model requests are included in usage.

Draft preflight now forwards the workspace's configured `YoutubeTranscriptEngine` to inline Librarian ingestion. Watch-only classification checks actual absence of parsed files, including explicit draft-source selections. Deterministic blockers also enforce at most one moment per heading concept, all heading depths, adjacent real tN citations and <=180-second bounds. Semantic alignment/omission stays with the independent checker.

### Provider usage

Recorded completed resumed evaluations, including the failed video probe; no fixed subscription-provider call cap, three-identical-failure loop guard. The lost host-interrupted scout's unrecorded consumption remains **unknown** and is not included in these totals. Audit/re-import/fresh score scripts use no models. Classifier was off in live eval config; no calibration or on-mode promotion is claimed.

| Provider | Fresh | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| openai-codex | 201247 | 14133 | 493440 | 0 |
| github-copilot | 27 | 5171 | 359925 | 59246 |

Ledgers: `/tmp/studium-m12-scout-Z0cqjC/usage.json`, `/tmp/studium-m12-redraft-a01buk/usage.json`, `/tmp/studium-m12-video-wU2dPM/usage.json`, `/tmp/studium-m12-video-KX8Rpf/usage.json`.

### Final validation

- Required initial install: `pnpm install --frozen-lockfile --prefer-offline` — passed.
- `pnpm --filter @studium/server exec vitest run src/ingest/ src/search/ src/tree/ src/agent/ src/jobs/draft-job.test.ts src/jobs/ingest-job.test.ts src/jobs/plan-job.test.ts src/jobs/source-preflight.test.ts src/jobs/log.test.ts src/course/build.test.ts src/inbox/plan-kickoffs.test.ts src/workspaces/manager.test.ts` — 484 passed, 1 failed. The failure at `server/src/agent/efficiency.test.ts:46` was caused by new summary text omitted from the retrieval budget. Fixed by budgeting the actual escaped rendering, including summary overhead.
- `pnpm --filter @studium/server exec vitest run src/agent/efficiency.test.ts src/search/ src/jobs/source-preflight.test.ts src/course/build.test.ts src/agent/video-evidence.test.ts` — **39 passed**, including the formerly failing test. Together these verify all **485** distinct scoped tests; no full-suite run.
- `pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx` — **8 passed**.
- `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` — **5 passed**.
- `pnpm --filter @studium/server exec tsc --noEmit`; `pnpm --filter @studium/web exec tsc --noEmit`; `pnpm --filter @studium/shared exec tsc --noEmit` — passed.
- `pnpm --filter @studium/web build` — passed (existing large-chunk advisory).
- `rtk proxy pnpm exec biome check --write <changed .ts/.tsx/.json files>` — 60 files, passed, no remaining warnings; final read-only check recorded below.
- `node scripts/skill-history.mjs` — updated default-skill hashes.

### Items that do not fit / remaining limitations

- `server/src/youtube/types.ts:50`: metadata exposes title/author/thumbnail, not duration or manual/auto caption identity. Stopped verified-caption/length filtering at this contract; planner reports unknown rather than guessing. Transcript ladder integration itself remains in use.
- `server/src/ingest/strategies.ts:13`: the known Stack Overflow answer-order parameter is not a print/reader view. It is honestly named `answer-order`; no verified print/reader endpoint was implemented. Unknown sites use Readability.
- `server/src/jobs/source-preflight.ts:27`: scope concepts are deterministic comma/and-separated phrases; lexical coverage can over-match and is not proof of every claim. No-scope title matching is informational. Cache metrics reflect the last assessment (`measuredAt`), not a live recomputation after every import; unavailable cache means unknown.
- `server/src/jobs/source-preflight.ts:67`: inline source-import failure currently propagates and stops that draft. The scoped tests do not claim partial-ingest recovery.
- `server/src/agent/builtins/scout-sources.ts`: AMP/tracking and identical canonical URLs are deduped; unrelated mirrors without canonical/redirect identity cannot be safely inferred. Six leaders are fetched per invocation, not a cap on provider calls; agent can scout subsequent slots.
- Real search breadth, manual-caption preference, new-video ingestion success and classifier calibration could not be demonstrated with the observed remote results. These limitations do not authorize inventing sources, transcripts or metadata.
- Rewrites skip automatic scope expansion to preserve existing citations/media. New draft preflight remains active after plan-approved imports settle through the existing kickoff flow.

### Five-line memory log (for owner/orchestrator to add; AGENT_MEMORY.md untouched)

1. M12: implemented parse health, rich HTML extraction/section summaries, honest polite fetches and bounded job failure reasons; D34 added.
2. Added subject/level recipes, shadow sources.rank/video.useful, scout_sources and private bounded domain outcome hints.
3. Added pre-draft FTS concept coverage/gap scouting + inline Librarian imports and Course plan evidence counts; YouTube engine forwarded.
4. Temp re-import improved five of ten parses; checked polymers-style redraft Uncertain 5→0; blocked new video kept watch-only; real registered moment 159–216s verified.
5. Gotchas: valid TeX/linked “Truncated” headings must not be penalized; include summary escaping in retrieval budgets; caption/duration metadata absent; interrupted usage unknown.

## Changed files — one line per file

- `docs/decisions/LOG.md` — D34 source-quality and video-evidence decision.
- `docs/plans/2026-10-04-m12-redraft.md` — Live checked polymer redraft, uncertainty counts and usage.
- `docs/plans/2026-10-04-m12-source-audit.md` — Corrected read-only baseline parse scores.
- `docs/plans/2026-10-04-m12-source-comparison.md` — Three-subject current/proposed source comparison and scout usage.
- `docs/plans/2026-10-04-m12-source-proposed-scores.md` — Fresh parse scores and saved proposal limitations.
- `docs/plans/2026-10-04-m12-source-quality-report.md` — Phase checkpoints, final results, validation, deviations and file inventory.
- `docs/plans/2026-10-04-m12-source-reimport.md` — Ten-source final before/after table.
- `docs/plans/2026-10-04-m12-video.md` — Registered-video interval, exact quote and structural review.
- `server/scripts/source-audit.ts` — Read-only source-health audit CLI.
- `server/scripts/source-comparison-scores.ts` — Fetch and score real planner proposals without registration.
- `server/scripts/source-redraft-eval.ts` — Isolated real draft/checker evaluation with saved usage.
- `server/scripts/source-reimport.ts` — Temp-only ten-worst re-import; retain better parses.
- `server/scripts/source-scout-eval.ts` — Real three-subject Outliner recipe evaluation with ledger checkpoints.
- `server/scripts/source-video-eval.ts` — Live registered-transcript moment probe; saved response can be replayed without a model call.
- `server/src/agent/builtins/add-source.test.ts` — Focused behavior/compatibility tests for add-source.ts.
- `server/src/agent/builtins/add-source.ts` — Reject image pages with save_asset guidance.
- `server/src/agent/builtins/scout-sources.test.ts` — Focused behavior/compatibility tests for scout-sources.ts.
- `server/src/agent/builtins/scout-sources.ts` — Canonicalize, rank and fetch candidates, filter unhealthy/thin parses and pass optional selected callback.
- `server/src/agent/builtins/web-fetch.test.ts` — Focused behavior/compatibility tests for web-fetch.ts.
- `server/src/agent/builtins/web-fetch.ts` — Report both failures, remember blocked hosts and use rich/polite fallback.
- `server/src/agent/cache-log.ts` — Private confined no-follow bounded telemetry reader.
- `server/src/agent/chat-service.ts` — Supply classifier to research toolset and keep scout tool behind research routing.
- `server/src/agent/decisions/index.ts` — Register new source/video classifier decisions.
- `server/src/agent/decisions/sources.rank.ts` — Six-criterion shadow source ranking with caller LLM fallback.
- `server/src/agent/decisions/video.useful.ts` — Shadow concept suitability decision with conservative fallback.
- `server/src/agent/roles.ts` — Expose scout_sources through existing research allowlist.
- `server/src/agent/run-role.ts` — Build scouting tool, account classifier usage and share job blocked-host map.
- `server/src/agent/video-evidence.test.ts` — Focused behavior/compatibility tests for video-evidence.ts.
- `server/src/agent/video-evidence.ts` — Adjacent real transcript citations, bounded timestamps, one moment/concept and checker review hints.
- `server/src/course/build.test.ts` — Focused behavior/compatibility tests for build.ts.
- `server/src/course/build.ts` — Expose optional measured evidence on matching Course chapters.
- `server/src/ingest/domain-outcomes.ts` — Private domain outcomes and bounded scouting priors.
- `server/src/ingest/error-reason.ts` — Bounded control/credential/token-redacted public failure reasons.
- `server/src/ingest/extract.test.ts` — Focused behavior/compatibility tests for extract.ts.
- `server/src/ingest/firecrawl.ts` — Optional HTML/waitFor request and HTML response preservation.
- `server/src/ingest/html-structure.ts` — Exact TeX, GFM table, language code and figure-caption preservation.
- `server/src/ingest/ids.ts` — Canonical AMP/tracking URLs and arXiv HTML IDs.
- `server/src/ingest/image-url.ts` — Recognize image file URLs and Wikimedia/Wikipedia File pages.
- `server/src/ingest/images.ts` — Optional extracted figure caption metadata.
- `server/src/ingest/library.ts` — Store source quality, sections and summaries.
- `server/src/ingest/polite-fetch.ts` — One bounded Retry-After retry and open-access hints.
- `server/src/ingest/quality.test.ts` — Focused behavior/compatibility tests for quality.ts.
- `server/src/ingest/quality.ts` — Pure extraction-health scoring and retry threshold.
- `server/src/ingest/sections.ts` — Shared stable heading/page/time anchors and extractive summaries.
- `server/src/ingest/split.ts` — Fence-aware H1/H2 splitting.
- `server/src/ingest/strategies.test.ts` — Focused behavior/compatibility tests for strategies.ts.
- `server/src/ingest/strategies.ts` — Explicit wiki/arXiv/JS/answer-order registry with Readability fallback.
- `server/src/ingest/types.ts` — arXiv HTML-first healthy parse with PDF fallback.
- `server/src/ingest/web.test.ts` — Focused behavior/compatibility tests for web.ts.
- `server/src/ingest/web.ts` — Preserve math/code/captions before Readability and retain better low-quality retry.
- `server/src/ingest/wikipedia.ts` — Wikipedia/Wikisource API host/language routing and rich images.
- `server/src/jobs/draft-job.test.ts` — Existing source fixture now covers both eigenvalue/eigenvector scope concepts.
- `server/src/jobs/draft-job.ts` — Preflight coverage, truthful watch-only payload, independent video checks and checked citation outcomes.
- `server/src/jobs/ingest-job.ts` — Record low-quality/blocked outcomes and pass job context.
- `server/src/jobs/log.test.ts` — Focused behavior/compatibility tests for log.ts.
- `server/src/jobs/log.ts` — Persist and restore safe failed-job reasons.
- `server/src/jobs/plan-job.ts` — Pass job context for classifier accounting/shared fetch state.
- `server/src/jobs/source-preflight.test.ts` — Focused behavior/compatibility tests for source-preflight.ts.
- `server/src/jobs/source-preflight.ts` — FTS concept diagnostics, read-only gap scouting and inline Librarian ingestion.
- `server/src/search/coverage.test.ts` — Focused behavior/compatibility tests for coverage.ts.
- `server/src/search/coverage.ts` — Lexical concept coverage and bounded private cache persistence.
- `server/src/search/passages.ts` — Shared anchors/summaries and budget actual escaped rendered evidence.
- `server/src/workspaces/manager.ts` — Forward configured YouTube engine to draft preflight.
- `shared/src/api.ts` — Optional Course chapter EvidenceCoverage contract.
- `shared/src/schemas.ts` — Optional backwards-compatible source quality frontmatter.
- `skills/.defaults-history.json` — Regenerated default-skill content hashes.
- `skills/draft-chapter/SKILL.md` — Moment selection, paragraph placement, timestamp citation and watch-only rules.
- `skills/fact-check/SKILL.md` — Semantic moment mismatch and useful-unused-video review.
- `skills/find-sources/SKILL.md` — Recipe loading and broad quality-aware scouting.
- `skills/find-sources/references/recipes.md` — Subject/level slots, broad scouting, paper gating and useful-video criteria.
- `skills/media-authoring/SKILL.md` — When video teaches better, bounded moments and truthful transcript retry guidance.
- `skills/plan-set/SKILL.md` — Subject recipes and named individual video proposals.
- `web/src/components/CoursePlan.test.tsx` — Focused behavior/compatibility tests for CoursePlan.tsx.
- `web/src/components/CoursePlan.tsx` — Accessible evidence meter and weakest-concept text.

Final follow-up: `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts src/agent/video-evidence.test.ts src/ingest/strategies.test.ts` — **29 passed** after the final watch-only/heading/strategy corrections. Server `tsc --noEmit` passed again. `git diff --check` passed.

Final read-only Biome check: **60 files passed**. Regenerating skill history restored generator indentation; formatted that changed JSON, then the read-only check passed. Protected-path check passed (74 changed files, none in restricted paths). Branch remains `codex/m12`.

Exact final Biome command (expanded file list):

```sh
rtk proxy pnpm exec biome check \
  server/scripts/source-audit.ts \
  server/scripts/source-comparison-scores.ts \
  server/scripts/source-redraft-eval.ts \
  server/scripts/source-reimport.ts \
  server/scripts/source-scout-eval.ts \
  server/scripts/source-video-eval.ts \
  server/src/agent/builtins/scout-sources.test.ts \
  server/src/agent/builtins/scout-sources.ts \
  server/src/agent/decisions/sources.rank.ts \
  server/src/agent/decisions/video.useful.ts \
  server/src/agent/video-evidence.test.ts \
  server/src/agent/video-evidence.ts \
  server/src/ingest/domain-outcomes.ts \
  server/src/ingest/error-reason.ts \
  server/src/ingest/html-structure.ts \
  server/src/ingest/image-url.ts \
  server/src/ingest/polite-fetch.ts \
  server/src/ingest/quality.test.ts \
  server/src/ingest/quality.ts \
  server/src/ingest/sections.ts \
  server/src/ingest/strategies.test.ts \
  server/src/ingest/strategies.ts \
  server/src/jobs/source-preflight.test.ts \
  server/src/jobs/source-preflight.ts \
  server/src/search/coverage.test.ts \
  server/src/search/coverage.ts \
  server/src/agent/builtins/add-source.test.ts \
  server/src/agent/builtins/add-source.ts \
  server/src/agent/builtins/web-fetch.test.ts \
  server/src/agent/builtins/web-fetch.ts \
  server/src/agent/cache-log.ts \
  server/src/agent/chat-service.ts \
  server/src/agent/decisions/index.ts \
  server/src/agent/roles.ts \
  server/src/agent/run-role.ts \
  server/src/course/build.test.ts \
  server/src/course/build.ts \
  server/src/ingest/extract.test.ts \
  server/src/ingest/firecrawl.ts \
  server/src/ingest/ids.ts \
  server/src/ingest/images.ts \
  server/src/ingest/library.ts \
  server/src/ingest/split.ts \
  server/src/ingest/types.ts \
  server/src/ingest/web.test.ts \
  server/src/ingest/web.ts \
  server/src/ingest/wikipedia.ts \
  server/src/jobs/draft-job.test.ts \
  server/src/jobs/draft-job.ts \
  server/src/jobs/ingest-job.ts \
  server/src/jobs/log.test.ts \
  server/src/jobs/log.ts \
  server/src/jobs/plan-job.ts \
  server/src/search/passages.ts \
  server/src/workspaces/manager.ts \
  shared/src/api.ts \
  shared/src/schemas.ts \
  skills/.defaults-history.json \
  web/src/components/CoursePlan.test.tsx \
  web/src/components/CoursePlan.tsx
```
