# M18 — MinerU 4 and tutor plan changes

Specification: user’s M18 request, 2026-10-07. Implementation is single-agent; no commits, pushes, merges, `.env*` edits, or writes to real data.

## Plan

- [x] Part A: bounded exact-origin MinerU V1 client (upload/complete/job/poll/download), terminal states, deadline, cancellation, legacy discovery; PDF job progress and unpdf fallback.
- [x] Part A: stage data-URI figures with M14/M15 metadata; conservative HTML-table and OCR cleanup before existing clean/split/anchor/quality pipeline; original-first PDF refresh.
- [x] Part A: integrations status, deployment recipe, fake API and processing tests.
- [x] Part B: tutor-only request_plan_change starts the existing plan-set mode=change job; prompt/skill and wiring tests.
- [x] Verify ingest/agent/jobs plus touched modules, all three package types, web build, scoped Biome.
- [x] Real Refresh through an isolated server on a temp copy; before/after counts and 390 px source/section screenshots; stop owned server only.

## Constraints and decisions

- `.env.example` is excluded because the explicit prohibition says never touch `.env*`; commented examples go in DEPLOY.md.
- The V1 schema reports file progress, not page progress; UI will show waiting and terminal state honestly.
- The MinerU client accepts only its operator-configured HTTP(S) origin, rejects credentials and redirects, and bounds downloads. Public URL helpers stay unchanged.
- Figure bytes are staged until publication, preserved unmodified, and attributed using source licence/URL (unknown when absent).

## Progress

Initial repository and installed Python/OpenAPI reference review complete. Existing M17 smallest-change job and refresh publication/rollback are reused.

### Part A implementation

V1 upload/complete/job/poll/markdown+ZIP flow implemented, with page-scaled deadline,
exact-origin requests, redirect rejection, Bearer auth, configured tier, terminal
states, backoff and best-effort remote cancellation. All configured PDFs use
MinerU; unpdf remains fallback with job-log warning. Original-first PDF Refresh
uses the same extractor and stages figures through its existing locked rollback.
Embedded raster originals are hashed to figures/, recorded in images.json, and
rewritten relative to split files. Simple HTML tables become GFM; spans remain
HTML. Obvious punctuation OCR lines are dropped outside math/code/tables.
Integration status and CPU/basic deployment instructions added.

Reference detail: api_client.py:293 uses ZIP for include_images; api_server.py:1505
returns markdown separately. Adapter requests both and safely materializes archive
image references in memory before figure extraction (existing JSZip dependency).

Mismatch: web/src/components/Reader/MarkdownView.tsx:47 explicitly excludes raw
HTML from rendering. Spanning tables are preserved in storage but their UI
rendering step is stopped; no global HTML-renderer expansion is included.

### Part B implementation

Tutor request_plan_change tool enqueues plan-set mode=change for the current set,
using the existing M17 proposal/Inbox path and AI gate. Tutor prompt and explain
skill direct chapter/visual/video changes to the tool; skill history updated.
Tool errors do not claim success. Fake chat wiring checks curriculum stays intact.

Initial adapter/PDF tests: 22 passed. Broader scoped verification underway.
Real trial started against a full disposable copy at /tmp/studium-m18-jtv55te5;
port 18761, fresh test admin, no external MCP servers, no real model requests.

### Verification and real Refresh

- Broad requested server scope: 496 passed / 1 failed, 61 files. Existing failure:
  `server/src/agent/roles.test.ts:349`, “gives the tutor a bounded course summary and
  chapter/rewrite proposal instructions”: expected `Topic 1: accepted`, got
  `Topic 1: planned`. Reproduced using `git show HEAD:server/src/agent/prompt.ts`
  in a disposable test module (1 failed / 17 skipped); temporary modules removed.
  The fixture’s sample note does not match its replacement Topic curriculum.
- Follow-up ingest publication/API/PDF/cleanup tests: 43 passed / 0 failed (5 files).
- Warning retention/log and ingest/Refresh job tests: 27 passed / 0 failed (3 files).
- Final real-paper excerpt cleanup test: 4 passed / 0 failed.
- Web Integrations: 4 passed / 0 failed. All three package type checks and web build passed.

Real trial: temp full workspace `/tmp/studium-m18-jtv55te5/data/users/krishna`,
fresh local-only account database, port 18761. Invoked actual
`POST /api/library/lib-cheng-conditional-memory-via-scalable-lookup/refresh`,
MinerU `http://127.0.0.1:18750`, basic tier. No paid providers or external MCP
servers. Refresh wall time 342.083 s (job elapsed 340.321 s), compared with the
reference’s 263 s; this trial overlapped the scoped test run on the CPU host.

| Measure | Before (unpdf) | After (MinerU) |
| --- | ---: | ---: |
| Headings | 5 | 32 |
| Tables | 0 | 6 (4 HTML with spans, 2 GFM) |
| Display math | 0 | 9 |
| Inline math delimiters | 1 | 78 |
| Saved figures | 0 | 11 |
| Markdown characters | 99,051 | 113,114 |
| Parsed files | 3 | 32 |
| Quality score | 100 | 100 |

The before score was recomputed with existing `scoreParseQuality`; the old source
had no recorded quality field. The before inline delimiter match is not evidence
of good LaTeX extraction. Figure bytes remain original, captions come from adjacent
Figure lines, and this upload has no recorded source URL: sidecars use the local
`source.md` link with licence unknown. No fictitious paper licence is assigned.
The existing quality score measures extraction defects and saturates at 100;
structure improved substantially without increasing that score.
Refresh reports disappeared old page/heading anchors; existing matching section
anchors use the existing preservation logic.

Screenshot constraint: the two GFM-table sections have no mathematical equations;
math is in other sections, and the existing renderer does not render HTML tables.
Stopped the requested combined math+table screenshot step; capture separate real
math and GFM-table section previews at 390 px instead. No synthetic text added.

Final browser QA: source + table + math previews visually inspected at 390×1000.
Math preview renders 12 KaTeX nodes, table preview renders one GFM table; neither
has horizontal page overflow. No browser JavaScript errors. Both owned app-server
PIDs (3350464, 3371927) and owned Chrome runs stopped; MinerU health remains
`ok`, version `4.0.10`. The first app boot preceded the web build, so it did not
mount static routes; restarted only the owned app process before final captures.
Discarded preliminary screenshots and retained only verified screenshots.

## Changed files

- `docs/DEPLOY.md` — MinerU CPU/basic installation, user service, memory limit, tier guidance and commented environment examples.
- `docs/plans/2026-10-07-m18-mineru-report.md` — Part-by-part progress, implementation choices, verification, trial and deviations.
- `docs/plans/m18-evidence/390-section-math.png` — Verified 390 px real equation section with KaTeX rendering.
- `docs/plans/m18-evidence/390-section-table.png` — Verified 390 px real GFM table section.
- `docs/plans/m18-evidence/390-source.png` — Verified 390 px refreshed source page.
- `docs/plans/m18-evidence/browser-results.json` — Viewport, real section identifiers, render counts and no-error/no-overflow browser checks.
- `docs/plans/m18-evidence/refresh-results.json` — Actual Refresh result/job, before/after counts and recomputed before quality.
- `server/src/agent/builtins/request-plan-change.test.ts` — Job input, learner message, empty request and AI-refusal tests.
- `server/src/agent/builtins/request-plan-change.ts` — Tutor request tool starts existing plan-set change proposals scoped to the current set.
- `server/src/agent/chat-service.test.ts` — Faux tutor tool call enqueues change mode and leaves curriculum untouched.
- `server/src/agent/chat-service.ts` — Attach request_plan_change to real tutor sessions, including quick turns.
- `server/src/agent/prompt.ts` — Direct requested chapter/visual/video plan changes to the new Inbox proposal tool.
- `server/src/agent/roles.test.ts` — Classify request_plan_change as a caller-supplied contextual tool.
- `server/src/agent/roles.ts` — Declare the contextual tutor plan-change tool.
- `server/src/ingest/fixtures/mineru-excerpt.md` — Short real paper equation/table/junk excerpt; no base64 payload or whole paper.
- `server/src/ingest/library.test.ts` — Embedded figure publication test with no network requests.
- `server/src/ingest/library.ts` — Publish staged figures/sidecars without remote refetch and use correct relative links after splitting.
- `server/src/ingest/mineru-markdown.test.ts` — Caption/byte/provenance/tiny-image, HTML table, math and junk-cleanup tests.
- `server/src/ingest/mineru-markdown.ts` — Stage embedded rasters with provenance, convert simple tables, filter OCR junk and adjust split figure links.
- `server/src/ingest/mineru.test.ts` — Fake V1 happy/partial/failure/cancel/timeout/abort, legacy, health, archive and exact-origin security cases.
- `server/src/ingest/mineru.ts` — Exact-origin V1 upload/job/poll/download client, archive figures, health, deadlines and cancellation; legacy discovery.
- `server/src/ingest/pdf.test.ts` — Configured good/poor-text PDFs both use MinerU; fallback and metadata regression coverage.
- `server/src/ingest/pdf.ts` — Use MinerU for all configured PDFs, preserve unpdf fallback and report progress/warnings.
- `server/src/ingest/refresh.test.ts` — Original PDF plus arXiv provenance routes through PDF extraction and publishes figure metadata/bytes.
- `server/src/ingest/refresh.ts` — Prefer saved PDF originals, preserve source provenance and stage figures within existing locked publication.
- `server/src/ingest/types.ts` — Carry PDF progress/warnings/licence and staged embedded figures across extraction.
- `server/src/jobs/ingest-job.ts` — Forward PDF progress and preserve extraction warnings alongside summary warnings.
- `server/src/jobs/log.test.ts` — Fallback warning history round-trip and secret-redaction test.
- `server/src/jobs/log.ts` — Persist sanitized successful-job warnings and restore them through history parsing.
- `server/src/jobs/refresh-source-job.test.ts` — Progress forwarding and warning retention tests.
- `server/src/jobs/refresh-source-job.ts` — Forward parsing progress and retain per-source fallback warnings in completed job results.
- `server/src/routes/settings.test.ts` — Fake MinerU health/auth/status secrecy coverage.
- `server/src/routes/settings.ts` — Check MinerU V1 health and expose reachability/version/tier without secrets.
- `skills/.defaults-history.json` — Register only the updated explain skill hash.
- `skills/explain/SKILL.md` — Tutor plan-change procedure and required learner response.
- `web/src/components/Settings/IntegrationsSection.test.tsx` — Reachable/unreachable MinerU UI coverage.
- `web/src/components/Settings/IntegrationsSection.tsx` — MinerU reachability/version/tier status in existing integration styling.

## Exact verification commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/ingest/ src/agent/ src/jobs/ src/routes/settings.test.ts` | 496 passed, 1 pre-existing failed; 60 passing files / 1 failed file |
| `pnpm --filter @studium/server exec vitest run src/ingest/library.test.ts src/ingest/mineru.test.ts src/ingest/mineru-markdown.test.ts src/ingest/pdf.test.ts src/ingest/refresh.test.ts` | 43 passed, 0 failed |
| `pnpm --filter @studium/server exec vitest run src/jobs/log.test.ts src/jobs/ingest-job.test.ts src/jobs/refresh-source-job.test.ts` | 27 passed, 0 failed |
| `pnpm --filter @studium/server exec vitest run src/ingest/mineru-markdown.test.ts` | 4 passed, 0 failed after final real-excerpt fixture update |
| `pnpm --filter @studium/web exec vitest run src/components/Settings/IntegrationsSection.test.tsx` | 4 passed, 0 failed |
| `pnpm --filter @studium/server exec tsc --noEmit` | Pass (final rerun after warning changes) |
| `pnpm --filter @studium/web exec tsc --noEmit` | Pass |
| `pnpm --filter @studium/shared exec tsc --noEmit` | Pass |
| `pnpm --filter @studium/web build` | Pass |
| `git diff --check` | Pass |

The original-prompt failure confirmation used
`pnpm --filter @studium/server exec vitest run src/agent/m18-baseline-roles.tmp.test.ts -t 'gives the tutor a bounded course summary'`:
1 failed (same accepted/planned assertion), 17 skipped. Both temporary modules were removed.
Early failing development tests (escaped-dollar OCR detection and remote re-capture of
local figure links) were corrected and pass in the final focused runs above.
No full-repository suite or paid-provider smoke test was run. Dependencies were
prepared with `pnpm install --frozen-lockfile --prefer-offline`.

Final scoped Biome command (30 supported changed files; 0 diagnostics):

```sh
rtk proxy pnpm exec biome check server/src/agent/chat-service.test.ts server/src/agent/chat-service.ts server/src/agent/prompt.ts server/src/agent/roles.test.ts server/src/agent/roles.ts server/src/ingest/library.test.ts server/src/ingest/library.ts server/src/ingest/mineru.test.ts server/src/ingest/mineru.ts server/src/ingest/pdf.test.ts server/src/ingest/pdf.ts server/src/ingest/refresh.test.ts server/src/ingest/refresh.ts server/src/ingest/types.ts server/src/jobs/ingest-job.ts server/src/jobs/log.test.ts server/src/jobs/log.ts server/src/jobs/refresh-source-job.test.ts server/src/jobs/refresh-source-job.ts server/src/routes/settings.test.ts server/src/routes/settings.ts skills/.defaults-history.json web/src/components/Settings/IntegrationsSection.test.tsx web/src/components/Settings/IntegrationsSection.tsx docs/plans/m18-evidence/browser-results.json docs/plans/m18-evidence/refresh-results.json server/src/agent/builtins/request-plan-change.test.ts server/src/agent/builtins/request-plan-change.ts server/src/ingest/mineru-markdown.test.ts server/src/ingest/mineru-markdown.ts
```

## Not done / deviations / open questions

- `.env.example` left untouched because “never touch `.env*`” is explicit. The
  three commented examples are supplied in DEPLOY.md instead.
- Preserved spanning HTML tables, but stopped their UI rendering step:
  `web/src/components/Reader/MarkdownView.tsx:47` excludes raw HTML. No dependency
  or global renderer/security change was introduced.
- The requested single math+table screenshot cannot reflect this PDF’s real
  split sections with the current renderer; separate verified screenshots saved.
- Source-local figure previews are an existing limitation: `NoteImage.tsx:26`
  uses set-scoped media resolution, and `shared/src/media-paths.ts:10` excludes
  library paths. Figures are extracted on disk with sidecars; this task did not
  expand source-serving/media-rendering APIs. Uploaded figures with only local
  provenance also meet the existing HTTPS-only `save_asset` input boundary at
  `server/src/agent/builtins/save-asset.ts:44`; no public provenance URL was invented.
- The pre-existing course-summary assertion at `server/src/agent/roles.test.ts:349`
  remains failing; unrelated course matching/fixture behavior was not changed.
- MinerU V1 exposes file-level progress, so waiting/status is displayed without
  fabricated page completion. No licence inferred from an unrecorded public paper.
- No real-provider tutor planning trial (faux wiring + existing plan-job tests only).
  No iPhone/WebKit test. No commit, push, merge, live app restart, real-data write,
  `.env*` change, MinerU installation change or MinerU service restart.

## AGENT_MEMORY.md entry (five lines; memory itself untouched)

```text
2026-10-07 · M18 · MinerU V1/PDF cleanup, job warnings, integration status and tutor plan requests implemented; uncommitted.
MinerU uses exact-origin upload/job/poll/markdown+ZIP, all configured PDFs, page-scaled timeout, abort, unpdf fallback; figures stage into M14/M15 sidecars.
Tutor request_plan_change starts M17 plan-set mode=change for Inbox approval; explain skill hash updated.
Verified scoped tests (496 pass/1 baseline fail plus focused passes), all types/build/Biome; temp Refresh 342 s: headings 5→32, tables 0→6, display math 0→9, figures 0→11, quality 100→100.
Open: raw HTML tables/source-local figure previews and HTTPS-only figure reuse; .env.example excluded, separate math/table shots; roles.test.ts:349 baseline failure.
```
