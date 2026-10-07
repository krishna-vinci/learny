# M11 implementation report

Latest: [M11 follow-up report](2026-10-02-m11-followup-report.md) fixes renderer/p5 issues, adds a bounded rewrite revision, and records successful real history/PCA rewrites plus the failed-case visual reruns. Sections below describe the original M11 run and its former 200-call cap.

Implementation and scoped validation finished. Visual reliability and a successful post-fix live rewrite remain unproven; failures and blocked items are recorded below. No repository commits, pushes, branch changes, new app dependencies, live data writes, or AGENT_MEMORY edits.

## Baseline (Part 3 first)

Dependencies installed with `pnpm install --frozen-lockfile --prefer-offline` (966 packages; no manifest changes).
Both requested subscription models were found with configured auth; no paid provider fallback.
Harness: `server/scripts/visual-eval.ts`, 21 cases, Chrome `/usr/bin/google-chrome`, real sandbox document builder/runtime, real widget SVG layouts, existing Vega compiler, PNG + spec judge. Evidence: `/tmp/studium-m11-evidence/`.

Harness deviations: skills/references are preloaded, tools disabled, one file bundle per drafter request; the existing drafter system-prompt builder is reused. This bounds model calls. It does not measure agent repair after validation. Widget geometry is tested through the sandbox; React widget controls are not tested here.

An initial harness run conflicted with the role's instruction to load skills. A SIGTERM closed Chrome but did not stop Pi's process, briefly overlapping its replacement. Only those started processes were stopped with SIGKILL. Generated outputs were salvaged; the ledger was conservatively reconciled to 34 reserved requests before continuing. A ledger ownership lock and append-only request/result telemetry now prevent concurrent runs and count failures. Prototype artifacts remain under the evidence directory. Pre-lock interrupted requests have incomplete usage telemetry; reported tokens are observed usage, not an exact total of those interrupted calls.

Existing renderer issue: `shared/src/visuals/scene.ts:23 (position) and :41 (font)` positions the rotated y-axis label at x=18 with a 26px font; Chrome shows the left edge clipped at 360px. This item is outside Parts 1–2's skill/validation scope; it is recorded rather than changing the shared widget renderer.

Baseline complete: 42 rows, Luna valid 20/21, form 21/21, renders 8/20, quality 3.15/5; Sol valid 21/21, form 20/21, renders 10/20, quality 3.57/5. None is excluded from the render denominator. 102 requests reserved including interrupted prototype work. Baseline skill frozen at `/tmp/studium-m11-evidence/baseline-skill/`. Eval adapter tests: 3 passed.

## Part 1
Complete: 92-line decision-table skill; four strict widget JSON templates; four complete HTML sketches; ten SVG posters including three story scenes; fill slots and seven-subject idea references. Runtime docs now correctly place Play/Pause in the app strip. JSON cannot legally contain comment markers, so JSON fill slots live in `references/fill-slots.md`; HTML/SVG use marked slots. Default hashes registered and JSON formatted.

Template Chrome QA: all 8 primary templates pass validation; 5 have no runtime/console/overflow errors. Plot/matrix templates expose the pre-existing y-axis clipping at `shared/src/visuals/scene.ts:23 (position) and :41 (font)`. The p5 template draws correctly but p5 2.3.4 emits two accelerometer permissions-policy console errors in the unchanged opaque sandbox (`web/public/visual-runtime/p5.bb8b82b97fcb.js:1`); strict eval records that as a render failure. No sandbox permissions were widened. PNGs and `template-qa.json` are in the evidence directory.

## Part 2
Complete: HTML hard rules (header/posters, undeclared globals, mount, network APIs, script sources, SVG viewBox); advisory unused-library/theme-fallback/missing-poster-file warnings flow through existing media tool results. Widget errors name field paths and concrete examples without union dumps. The JS lint is deliberately heuristic, not a security parser; the unchanged sandbox/CSP remains the boundary.

Validation before Part 4: 140 tests across tree/, tools, eval adapter and existing draft job pass. Server/web/shared type checks and web build pass (existing >500KB chunk warning). Final validation after the rewrite fix: 143 tests across the same 12 files pass; server types and changed-file biome pass.

## After eval (Part 3 again)
Complete: all 42 rows; 158 requests reserved overall. Luna valid 21/21 (+1), form 21/21, renders 12/20 (+4), quality 3.38 (+0.23). Sol valid 21/21, form 21/21 (+1), renders 11/20 (+1), quality 3.43 (−0.14). Small-model output validity improved; “any model reliably produces correct, good-looking visuals” remains unproven.

After judges batch up to three independent PNG/spec pairs in one request; baseline judges were separate. Baseline reused 15 prototype responses. Widget screenshots exercise shared geometry in the real sandbox but omit React controls and widget narration chrome; quality scores can penalize missing on-screen captions. Interpret quality deltas directionally, not as a controlled comparison. Shared axis/timeline layouts still explain most render failures. All 42 baseline bundles were revalidated offline with Part 2; no additional failures. Detailed rows and quotes are in the visual eval report.

## Part 4
Executed the actual rewrite job on two temporary trees, using Sol as drafter and Luna as checker. The source git history shows neither selected chapter had a previous rewrite commit. Evidence: `/tmp/studium-m11-rewrite-WLVHlI/`; detailed assertions, commits and openings: `2026-10-02-m11-rewrite-report.md`.

History: **FAIL before fix**, 10/11 assertions pass. Of 77 resulting sentences, 35.1% are new; only 15.3% of 59 original sentences were replaced. Metadata, every citation id and its readable definition, figures/declarations, media bytes, clean teaching lint, draft→checked transition, drafter/checker commits and recoverable original all pass.

Root cause: the generic drafter instruction permits surgical edits (`server/src/agent/prompt.ts:109`), the old rewrite task did not demand replacement throughout, and old `validateRewrite` only enforced preservation/status. The task now explicitly demands substantial prose replacement (`server/src/jobs/draft-job.ts:463`); the guard uses normalized sentence comparison (`:83`) and rejects either fraction below 40% (`:133`). Existing rejection handling restores the original note before commit/checking. Added three regression cases covering append-only, shallow changes, and metadata/citation/media exclusions; the measurement also handles entirely short-sentence notes. The pre-fix live history output would fail the new guard. The simple ratio detects textual replacement, not semantic teaching quality, and remains a heuristic.

Non-history: **BLOCKED** in checker revision/recheck. The original Strang library entry is metadata/summary only (`/path/to/studium/data/users/<username>/library/lib-strang-la/source.md:11`); `parsed.md` and `parsed/` are absent, leaving `#p12` unresolved. The checker report at `/tmp/studium-m11-rewrite-WLVHlI/linear-algebra/linear-algebra/log/checks/01-vectors.md:9` records the evidence gap. Its independent web cross-check cannot verify the retained Strang citation. Stopped this item without inventing source text or changing live data. At recheck the shared cap was reached: **200/200 reserved model requests**. No further model requests or live post-fix rerun were made.

Offline math inspection: 97.9% new-after / 91.7% replaced-before, metadata/citation definitions/media preserved, note-lint clean, drafter commit and original recoverable. Current status is draft; no checker commit. Figure preservation is vacuous for this chapter (it has no figures). These observations do not constitute an end-to-end PASS.

## Eval summary

| Model | Valid before→after | Form before→after | Renders before→after | Quality before→after |
| --- | --- | --- | --- | --- |
| github-copilot/gpt-6-luna | 20/21→21/21 | 21/21→21/21 | 8/20→12/20 | 3.15→3.38 |
| openai-codex/gpt-6.1-sol | 21/21→21/21 | 20/21→21/21 | 10/20→11/20 | 3.57→3.43 |

Renders excludes the appropriate none case. Quality averages only available judge verdicts (baseline Luna has 20; all other groups 21). Widget captions/controls omitted from screenshots and differing prototype/batched judge execution limit comparison. Axis-label clipping (`shared/src/visuals/scene.ts:23`, `:41`), long endpoint labels (`shared/src/visuals/timeline.ts:77`) and p5 console warnings are unresolved outside this skill/validator change.

| Provider | Observed fresh | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| github-copilot | 192 | 47,495 | 814,395 | 636,180 |
| openai-codex | 627,165 | 32,427 | 317,696 | 0 |

These are the final shared ledger's Pi-reported tokens, including rewrite work. Pre-lock interrupted usage is incomplete; reserved requests include failed/interrupted attempts.

## Tests and checks

Final scoped run: `pnpm --filter @studium/server exec vitest run src/tree/ src/agent/tools.test.ts src/agent/eval-runtime.test.ts src/jobs/draft-job.test.ts` — **143 passed, 0 failed, 12 files**. Before the rewrite fix, the same command passed 140 tests. No full-suite run.

Earlier focused runs:
- `pnpm --filter @studium/server exec vitest run src/tree/media.test.ts src/agent/tools.test.ts` — 41 passed, 0 failed (media 24; tools 17).
- `pnpm --filter @studium/server exec vitest run src/agent/eval-runtime.test.ts` — 3 passed, 0 failed.
- `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts -t 'rewrite chapter job'` — 6 passed, 15 skipped, 0 failed after fix.
- During development one media error-example assertion and one eval spy assertion failed; corrected and covered by final passing scope.

Required types/build:
- `pnpm --filter @studium/server exec tsc --noEmit` — pass (repeated after final rewrite changes).
- `pnpm --filter @studium/web exec tsc --noEmit` — pass.
- `pnpm --filter @studium/shared exec tsc --noEmit` — pass.
- `node web/scripts/build-visual-runtime.mjs` — pass, runtime assets unchanged in git.
- `pnpm --filter @studium/web build` — pass, existing chunk-size warning.
- `rtk proxy pnpm exec biome check server/src/agent/media-warnings.ts server/src/agent/tools.test.ts server/src/jobs/draft-job.test.ts server/src/jobs/draft-job.ts server/src/tree/media.test.ts server/src/tree/media.ts server/src/tree/visual-lint.ts server/src/agent/eval-runtime.ts server/src/agent/eval-runtime.test.ts server/scripts/visual-eval.ts server/scripts/rewrite-eval.ts server/scripts/visual-eval-cases.json skills/.defaults-history.json skills/make-visual/references/templates/*.json` — 17 files, pass.
- `git diff --check` — pass.

Model/browser checks:
- Baseline: `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/visual-eval.ts --phase baseline --out /tmp/studium-m11-evidence --puppeteer /home/<username>/.npm/_npx/73bcf459b506fa77/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js` — 42 rows completed, with recorded validity/render failures; preserved prototype responses resumed from checkpoints.
- Template QA: `pnpm --filter @studium/server exec node --import tsx scripts/visual-eval.ts --phase after --out /tmp/studium-m11-evidence --templates --puppeteer /home/<username>/.npm/_npx/73bcf459b506fa77/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js` — 8/8 valid, 5/8 strict renders clean.
- After: `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/visual-eval.ts --phase after --out /tmp/studium-m11-evidence --judge-batch-size 3 --puppeteer /home/<username>/.npm/_npx/73bcf459b506fa77/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js` — 42 rows completed; all valid/form-correct, recorded render failures.
- Rewrite: `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/rewrite-eval.ts --ledger /tmp/studium-m11-evidence/calls.json` — history FAIL, math BLOCKED, as detailed above.
- `pnpm --filter @studium/server exec node --import tsx scripts/visual-eval.ts --phase after --out /tmp/studium-m11-evidence --report-only` — final report refreshed offline, no model requests.
- `pnpm --filter @studium/server exec node --import tsx /tmp/studium-m11-offline.mts` — final temp-tree assertions inspected offline, no model requests; result `offline-final.json`.

## Not done / open questions

No live post-fix rewrite proof: the 200-call cap is exhausted. Non-history checker completion requires real parsed source evidence and a separate authorized eval budget. Renderer fixes and React widget-control QA remain separate work. Reliability claim not established. JSON fill markers use a separate reference because comments invalidate strict JSON. The tooling/quality limitations and interrupted prototype are disclosed above.

## Five-line memory log (for orchestrator; AGENT_MEMORY unchanged)

1. M11: replaced make-visual with ≤120-line template-first guidance, 8 primary templates and 10 SVG posters; registered defaults.
2. Visual write validation now teaches header/library/mount/network/viewBox/widget fixes and returns advisory theme/poster warnings.
3. Baseline/after across 21×2 cases: after valid/form 42/42; Luna render 8→12/20, quality 3.15→3.38; Sol 10→11/20, 3.57→3.43; reliability unproven.
4. Real history rewrite failed replacement (35% new/15% replaced); prompt + guard fixed with regression tests; math blocked by missing Strang parsed evidence and 200-call cap.
5. 143 scoped tests/types/build pass; no live writes/repo commits; gotchas: shared y-axis/timeline clipping, p5 sandbox console warnings, widget-control and interrupted-token eval limitations.

## Changed files (one line each)

- `docs/plans/2026-10-02-m11-implementation-report.md` — Record part progress, changed files, commands, limitations and memory log.
- `docs/plans/2026-10-02-m11-rewrite-report.md` — Record real rewrite assertions, openings, failure root cause and blocked verification.
- `docs/plans/2026-10-02-m11-visual-eval-report.md` — Record all 84 eval rows, PNG paths, failure quotes, deltas and token totals.
- `server/scripts/rewrite-eval.ts` — Run real rewrite jobs in temporary trees and report preservation/replacement assertions.
- `server/scripts/visual-eval-cases.json` — Provide 21 subject/level sections and expected/alternative forms.
- `server/scripts/visual-eval.ts` — Run visual generation, sandbox rendering, template QA, judging and before/after reports.
- `server/src/agent/eval-runtime.test.ts` — Test cap resume, failed-provider accounting, image judging and ledger ownership.
- `server/src/agent/eval-runtime.ts` — Wrap dev provider calls with persistent cap/lock/token telemetry and drafter/judge adapters.
- `server/src/agent/media-warnings.ts` — Return sketch style and unavailable-poster warnings through study-tool results.
- `server/src/agent/tools.test.ts` — Exercise successful sketch writes, warning delivery and clearing after repair.
- `server/src/jobs/draft-job.test.ts` — Reject append-only/shallow rewrites and test prose measurement exclusions.
- `server/src/jobs/draft-job.ts` — Require substantive chapter replacement in the task and preservation guard.
- `server/src/tree/media.test.ts` — Cover each visual hard rule and actionable widget validation messages.
- `server/src/tree/media.ts` — Apply teachable widget/HTML/SVG validation to visual writes.
- `server/src/tree/visual-lint.ts` — Implement actionable visual errors and advisory sketch style warnings.
- `skills/.defaults-history.json` — Register the updated skill/reference/template default hashes.
- `skills/make-visual/SKILL.md` — Replace guidance with a 92-line decision table, template workflow and checklist.
- `skills/make-visual/references/fill-slots.md` — Document comment-free JSON fill fields and exact SVD constraints.
- `skills/make-visual/references/runtime.md` — Correct which playback controls the app strip and runtime provide.
- `skills/make-visual/references/subjects.md` — Map seven subjects to three concrete visual ideas and templates each.
- `skills/make-visual/references/templates/d3-chart.html` — Copy-ready D3 axes/units sketch with responsive drawing and theme fallbacks.
- `skills/make-visual/references/templates/d3-chart.svg` — Static SVG poster for d3 chart; marked fill slots.
- `skills/make-visual/references/templates/function-plot.json` — Validated function plot example with slope control and labelled axes.
- `skills/make-visual/references/templates/function-plot.svg` — Static SVG poster for function plot; marked fill slots.
- `skills/make-visual/references/templates/matrix-transform.json` — Validated exact SVD decomposition; widget supplies three cumulative narrated scenes.
- `skills/make-visual/references/templates/matrix-transform.svg` — Static SVG poster for matrix transform; marked fill slots.
- `skills/make-visual/references/templates/p5-animation.html` — Copy-ready p5 animation using runtime time/play state and responsive sizing.
- `skills/make-visual/references/templates/p5-animation.svg` — Static SVG poster for p5 animation; marked fill slots.
- `skills/make-visual/references/templates/step-through.json` — Validated bubble-sort trace with realistic states and highlighted comparisons.
- `skills/make-visual/references/templates/step-through.svg` — Static SVG poster for step through; marked fill slots.
- `skills/make-visual/references/templates/svg-labelled-diagram.html` — Copy-ready labelled polymer sketch with slider and measured wrap/shrink text helper.
- `skills/make-visual/references/templates/svg-labelled-diagram.svg` — Static SVG poster for svg labelled diagram; marked fill slots.
- `skills/make-visual/references/templates/svg-story-end.svg` — Static SVG poster for svg story end; marked fill slots.
- `skills/make-visual/references/templates/svg-story-mid.svg` — Static SVG poster for svg story mid; marked fill slots.
- `skills/make-visual/references/templates/svg-story.html` — Copy-ready narrated three-scene SVG sketch with theme fallbacks and safe text layout.
- `skills/make-visual/references/templates/svg-story.svg` — Static SVG poster for svg story; marked fill slots.
- `skills/make-visual/references/templates/timeline.json` — Validated Hyderabad chronology with short endpoint labels and an era.
- `skills/make-visual/references/templates/timeline.svg` — Static SVG poster for timeline; marked fill slots.
