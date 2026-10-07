# M11 follow-up: plan and progress

Spec: the owner's M11 follow-up, extending `2026-10-02-m11-visuals-any-model.md`. Implement inline in the existing worktree; no agents, orchestration, commits/pushes, live data writes or dependency additions. The old 200-request cap is lifted only for github-copilot/openai-codex. Each case stops on three identical provider/tool failures; cases and rewrite revision passes are finite.

## Implementation and acceptance scope

- [x] Shared widget geometry: move the rotated y-axis label inside its margin; add `label(value,x,y,width,attrs)` with explicit SVG glyph length and bounded anchors. Limit process labels to their boxes, point annotations to their space, and timeline labels/eras to the visible interval. Clip matrix grid segments before serialization. Add four template-scene geometry tests and a long-label/zoom/endpoint test in `shared/src/visuals/widgets.test.ts`. Full labels remain in escaped SVG title children when abbreviated.
- [x] p5 source: `web/scripts/p5-sandbox.mjs` removes only the pinned library's unconditional deviceorientation/devicemotion event array. `build-visual-runtime.mjs` applies this before hashing; changed upstream code fails the build. No sandbox/CSP relaxation, eval console filter, or global EventTarget override. Test the actual bundled source and changed-hook failure.
- [x] Rewrite revision: distinguish a replacement-ratio failure from preservation errors. Permit one job-wide drafter revision with measured new-after/replaced-before percentages, original prose as delimited reference data, and the same write policy. Validate before committing/checking; restore after an unsuccessful revision. Test initial and checker-revision shallow→good recovery, and persistent-shallow behavior.
- [x] Eval plumbing: subscription-only requests, persistent usage telemetry and three-identical-failures loop guard replace the fixed cap. Preserve historical baseline/after rows; report the follow-up subset and an explicitly mixed-phase combined summary.
- [x] Verify templates at 360 px in real Chrome with real sandbox/bundles, and rerun every formerly failing after case for both models. Judge fresh outputs; record failures and PNGs.
- [x] Re-run history rewrite and a non-history chapter with parsed sources. The vectors chapter's Strang parse remains missing, so use `linear-algebra/notes/05-pca-in-practice.md` (two parsed Wikipedia sources; no previous rewrite commit), and report this substitution.
- [x] Finish scoped tests, all affected types and web build; update both original reports and final provider usage.

## Current validation

Initial scope: server draft-job/eval tests 26 passed. Geometry tests caught loss of full label text after abbreviation; full strings now remain as escaped titles. p5 source test needed the Node environment for file URLs; fixed. Matrix clipping tuples needed fixed tuple types; fixed.

Shared widget tests: 12 passed. Web p5/sandbox/widget tests: 7 passed. Server tests: 148 passed. Server/shared/web type checks pass. Template Chrome QA: **8/8 valid, 8/8 clean renders**, including all template widget story states and p5 with zero console errors. SVG element geometry is checked against the mapped viewBox as well as stage bounds. Both real rewrite cases and the 18 fresh visual generations/judges finished; they used distinct locked ledgers (`calls.json` for rewrite, `visual-calls.json` for visual eval), whose observed token usage is summed below.

Evidence is stored under `/tmp/studium-m11-followup-evidence` and `/tmp/studium-m11-followup-rewrite`. Historical M11 evidence remains intact.

## Visual eval result

Reran the union of nine failed after cases for **both models**: math basic/intermediate/advanced, science intermediate/advanced, history intermediate, finance basic/intermediate/advanced. Fresh first pass: Luna 9/9 valid/form/render; Sol 8/9 valid/render and 9/9 form. Sol's inverse-gas plot used empty point labels; its exact validator errors produced a valid/rendering result in one additional revision. Original failure and response/PNG evidence remain recorded in row.attempts and `firstpass-followup.json`. Optional eval repair is bounded to two revisions (three total attempts); no endless retries.

Final rerun rows: **18/18 valid, form-correct, rendering and judged**. Combined totals replace these nine rows/model and carry twelve earlier after rows/model forward; this is not a fresh full-generation run.

| Model | Valid combined | Form combined | Renders prior→combined | Mean quality prior→combined |
| --- | --- | --- | --- | --- |
| github-copilot/gpt-6-luna | 21/21 | 21/21 | 12/20→20/20 | 3.38→3.38 |
| openai-codex/gpt-6.1-sol | 21/21 | 21/21 | 11/20→20/20 | 3.43→3.48 |

The none case is excluded from renders. Quality remains subjective and screenshots omit React controls/widget narration as before. Point-label overlap and abbreviated long labels remain possible even when geometry fits. These results demonstrate the repaired rendering path, not uniform teaching quality or 100% first-pass model reliability. No p5 console error was filtered: the real bundled library now registers no motion sensors.

## Rewrite result

History: **PASS, 11/11**, 59→92 sentences, 100% new-after / 100% replaced-before. It reached checked status after the normal checker blocker revision/recheck, with drafter/checker commits and all preservation assertions passing. No shallow-replacement revision was needed in this real run; the one job-wide allowance is covered by stubbed shallow→good tests at initial draft and checker-revision stages.

PCA: **PASS, 11/11**, 64→118 sentences, 100% new-after / 100% replaced-before. It went draft→checked, with both role commits, clean note-lint, preserved metadata/citations/figures/media bytes and recoverable original. Both cited Wikipedia sources have parsed text. The checker independently recomputed the examples and verified the claims; it also reports a **major, non-blocking legacy locator issue**: retained `#centering`, `#covariance`, `#scaling`, `#class-separation` and `#nonuniqueness` anchors do not name actual parsed headings. Source passages were found by inspection. The task requires every original citation ID preserved, so these locators were not changed. NumPy sample code was inspected but not executed. Checker evidence: `/tmp/studium-m11-followup-rewrite/linear-algebra/linear-algebra/log/checks/05-pca-in-practice.md:9`.

| Target | Previous M11 result | Follow-up result |
| --- | --- | --- |
| History / Golconda | FAIL; 35.1% new-after, 15.3% replaced-before; 10/11 assertions | PASS; 100% / 100%; 11/11 |
| Non-history | Vectors BLOCKED: missing Strang parsed evidence, then old cap | PCA substituted; PASS; 100% / 100%; 11/11; legacy locator issue retained |

History opening before: “Before Hyderabad was founded, Golconda had already accumulated centuries of political and architectural history.” After: “Picture yourself looking up at Golconda's walls: are you seeing one ruler's fort, or several histories fitted together?”

PCA opening before: “How does PCA turn a table of correlated features into a smaller set of useful coordinates?” After: “Imagine a table with two sensor readings for every observation, and suppose the readings tend to rise together. Could we describe that shared movement with one coordinate instead of carrying both columns?”

## Final usage

**86 requests**: 60 real rewrite requests + 26 visual requests (18 first generations, six first-pass judge batches, one repair generation, one repair judge). All 86 have result events; no interrupted usage in this follow-up. These Pi-reported totals exclude the earlier M11 run.

| Provider | Fresh | Output | Cache read | Cache write |
| --- | --- | --- | --- | --- |
| github-copilot | 96 | 25,634 | 1,615,363 | 545,347 |
| openai-codex | 330,724 | 21,792 | 1,302,656 | 0 |

Ledgers: `/tmp/studium-m11-followup-evidence/calls.json` (rewrite), `visual-calls.json` (visual), `combined-usage.json` (sum). No fixed subscription request cap, no paid-provider fallback, and no unbounded retries. No loop guard fired in the real runs; repeated error/rejection/tool-loop behavior is covered by fakes.

## Tests run (exact commands)

- `pnpm install --frozen-lockfile --prefer-offline` — pass, already up to date; no dependency/lockfile changes.
- `pnpm --filter @studium/server exec vitest run src/tree/ src/agent/tools.test.ts src/agent/eval-runtime.test.ts src/jobs/draft-job.test.ts` — **148 passed, 0 failed, 12 files**. Draft-job 23; eval-runtime 6. Earlier scope passed 145 before adding thrown/rejected provider-failure coverage and the checker-revision recovery case.
- `pnpm --filter @studium/shared exec vitest run src/visuals/widgets.test.ts` — **12 passed, 0 failed**; includes four template-scene geometry cases and long-label/zoom/endpoint coverage. Repeated after adding path-bound assertions.
- `pnpm --filter @studium/web exec vitest run src/visual-runtime/p5-sandbox.test.js src/visual-runtime/sandbox.test.ts src/components/Reader/WidgetBlock.test.tsx` — **7 passed, 0 failed, 3 files**.
- `pnpm --filter @studium/server exec tsc --noEmit` — pass, repeated after final guard changes.
- `pnpm --filter @studium/shared exec tsc --noEmit` — pass.
- `pnpm --filter @studium/web exec tsc --noEmit` — pass.
- `node web/scripts/build-visual-runtime.mjs` — pass; patched p5 bundle hash `368097fcaa4b`.
- `pnpm --filter @studium/web build` — pass; existing >500KB chunk warning.
- `rtk proxy pnpm exec biome check shared/src/visuals/common.ts shared/src/visuals/scene.ts shared/src/visuals/function-plot.ts shared/src/visuals/matrix-transform.ts shared/src/visuals/timeline.ts shared/src/visuals/step-through.ts shared/src/visuals/widgets.test.ts skills/.defaults-history.json web/scripts/build-visual-runtime.mjs web/scripts/p5-sandbox.mjs web/src/visual-runtime/p5-sandbox.test.js server/src/jobs/draft-job.ts server/src/jobs/draft-job.test.ts server/src/agent/eval-runtime.ts server/src/agent/eval-runtime.test.ts server/scripts/visual-eval.ts server/scripts/rewrite-eval.ts` — pass, 17 files.
- `git diff --check` — pass.
- `node scripts/skill-history.mjs` and `rtk proxy pnpm exec biome check --write skills/.defaults-history.json` — pass; registered the four regenerated poster defaults.

Model/browser commands:

- `pnpm --filter @studium/server exec node --import tsx scripts/visual-eval.ts --phase followup --out /tmp/studium-m11-followup-evidence --templates --puppeteer /home/<username>/.npm/_npx/73bcf459b506fa77/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js` — 8/8 valid, 8/8 clean renders, 0 model requests.
- `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/rewrite-eval.ts --out /tmp/studium-m11-followup-rewrite --ledger /tmp/studium-m11-followup-evidence/calls.json --previous-report /tmp/studium-m11-followup-evidence/previous-rewrite-report.md` — history and PCA PASS, 22/22 assertions.
- `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/visual-eval.ts --phase followup --out /tmp/studium-m11-followup-evidence --ledger /tmp/studium-m11-followup-evidence/visual-calls.json --cases finance-advanced,finance-basic,finance-intermediate,history-intermediate,math-advanced,math-basic,math-intermediate,science-advanced,science-intermediate --judge-batch-size 3 --puppeteer /home/<username>/.npm/_npx/73bcf459b506fa77/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js` — 18 first-pass rows, 17/18 valid/render; 18/18 form, 17 judged.
- `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/visual-eval.ts --phase followup --out /tmp/studium-m11-followup-evidence --ledger /tmp/studium-m11-followup-evidence/visual-calls.json --cases science-intermediate --repair-failures --judge-batch-size 3 --puppeteer /home/<username>/.npm/_npx/73bcf459b506fa77/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js` — one Sol repair, valid/render, judged 4/5; Luna skipped because already passed.
- `pnpm --filter @studium/server exec node --import tsx scripts/visual-eval.ts --phase followup --out /tmp/studium-m11-followup-evidence --ledger /tmp/studium-m11-followup-evidence/visual-calls.json --report-only` — refreshed report offline, 0 requests.

Development failures (full-label export assertion, browser test file URL, tuple/Node fixture types, and an incorrectly headed blocker in the checker-revision test fixture) were fixed and all final scope passes. No full-suite test run, repository commits, branch changes, live data writes, environment edits, service restarts or sub-agents.

## Not done / deviations

Vectors remains unverifiable without Strang parsed text; PCA is the disclosed substitute. Legacy PCA anchors were preserved and remain reported. Uniform teaching quality and 100% first-pass reliability are not claimed. Long labels can be abbreviated (full text stays in escaped SVG titles) and labels can still overlap within the viewport. React controls/widget narration were unit-tested where relevant but are omitted from the eval screenshots, as in the previous harness. NumPy sample code was not executed. Browser bounds use a two-pixel tolerance. The p5 source patch is pinned to its current hook and intentionally fails if upstream code changes.

## Five-line memory log (AGENT_MEMORY unchanged)

1. 2026-10-02 M11 follow-up: fixed shared widget label/grid/zoom geometry and refreshed four poster defaults.
2. p5 bundle disables only denied motion listeners; 8/8 templates render cleanly with unchanged opaque sandbox/CSP.
3. Rewrite guard now permits one measured revision; real history and parsed-source PCA pass 11/11 each; Vectors still lacks Strang parse.
4. Reran 9 failed cases ×2 models: final 18/18 valid/render, one Sol repair; combined renders Luna 12→20/20 and Sol 11→20/20.
5. 167 scoped tests/types/build pass; 86 subscription calls logged; remaining: legacy PCA anchors, overlap/quality caveats; no live writes or repo commits.

## Changed files (one line each)

- `docs/plans/2026-10-02-m11-followup-report.md` — Record follow-up scope, evidence, exact checks, usage, deviations and memory log.
- `docs/plans/2026-10-02-m11-implementation-report.md` — Link latest follow-up and identify original results as historical.
- `docs/plans/2026-10-02-m11-rewrite-report.md` — Add successful history/PCA results, openings, before/after and provider totals; retain old results.
- `docs/plans/2026-10-02-m11-visual-eval-report.md` — Add 18 reruns, preserved first-pass failure/repair, mixed-phase deltas and provider totals.
- `server/scripts/rewrite-eval.ts` — Choose parsed-source PCA, preflight sources, retain previous report and log progress.
- `server/scripts/visual-eval.ts` — Support follow-up phase, strict viewBox geometry, separate ledger and bounded recorded repairs.
- `server/src/agent/eval-runtime.test.ts` — Cover >200-call resume, repeated provider/tool failures, thrown/rejected errors and ledger ownership.
- `server/src/agent/eval-runtime.ts` — Remove fixed call cap; enforce subscription providers and three identical failures with usage telemetry.
- `server/src/jobs/draft-job.test.ts` — Exercise initial/checker-revision shallow→good completion and persistent-shallow restoration after one job-wide revision.
- `server/src/jobs/draft-job.ts` — Give a shallow rewrite one measured, scoped revision before restoration/failure.
- `shared/src/visuals/common.ts` — Allow escaped title children for the full text of abbreviated labels.
- `shared/src/visuals/function-plot.ts` — Bound legend/point labels and hide points outside plotted domains.
- `shared/src/visuals/matrix-transform.ts` — Clip transformed grid paths and hide off-plot basis endpoints.
- `shared/src/visuals/scene.ts` — Bound text glyph length/anchors/baselines and move the rotated y-axis label into its margin.
- `shared/src/visuals/step-through.ts` — Fit trace labels within array/graph/box widths.
- `shared/src/visuals/timeline.ts` — Bound event/era labels and clip eras to the zoomed visible interval.
- `shared/src/visuals/widgets.test.ts` — Check every template scene label/path and long-label/endpoint/zoom geometry.
- `skills/.defaults-history.json` — Register four regenerated widget-poster default hashes.
- `skills/make-visual/references/templates/function-plot.svg` — Regenerate the matching static widget poster with corrected geometry and fill marker.
- `skills/make-visual/references/templates/matrix-transform.svg` — Regenerate the matching static widget poster with corrected geometry and fill marker.
- `skills/make-visual/references/templates/step-through.svg` — Regenerate the matching static widget poster with corrected geometry and fill marker.
- `skills/make-visual/references/templates/timeline.svg` — Regenerate the matching static widget poster with corrected geometry and fill marker.
- `web/scripts/build-visual-runtime.mjs` — Apply the p5 motion patch before hashing the bundle.
- `web/scripts/p5-sandbox.mjs` — Remove only the pinned motion registration and fail on upstream hook changes.
- `web/src/visual-runtime/p5-sandbox.test.js` — Verify the actual p5 source transformation and changed-hook failure.
