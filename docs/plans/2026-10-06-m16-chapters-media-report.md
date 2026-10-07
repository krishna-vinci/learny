# M16 — Chapter numbers, honest visual counts, use every useful image: implementation report

Worktree `m16-chapters-media`, baseline `f7363752678ce1fc9c8136ef50758ce1802f3389`
(amended after the Astra acceptance review). No commit, push, merge, dependency,
`.env*`, `data/` or `.claude/` change. Live `data/users/<username>` was read only; all
trials ran on a `/tmp` copy and every started process was stopped.

## Part A — chapter numbers and media counts

- `NoteSummary.number` is the chapter number from `curriculum.md` via `chapterExists`
  identity (`server/src/tree/read.ts`); a filename prefix is never the source. The
  live polymers `notes/04-atoms-…md` is chapter 1 (seen in the set screenshot).
- Shown on: set-page note rows (number column), sidebar (`1. Title`), reader
  `Chapter N` above the title in both Reading and Visuals, Today's next-chapter
  line/item, Practice pickers (note select, quiz checklist, saved problem sets),
  Cards rows, drafting rows in the set page/sidebar, Activity chapter rows, and book
  headings `Chapter N · Title`. Notes outside the plan show no number.
- `server/src/course/build.ts` accepts a brief whose visuals match either the raw
  curriculum intents or the draft-time `withInteractiveFallback` intents, and appends
  planned intents missing from an older brief as still-to-make. Visuals carry
  `interactive` from `interactiveIntent`.
- `ChapterMediaStatus` prints `Pictures in text: x/y made · Visuals tab: a/b made`
  and marks interactive items `(Visuals tab)`. Covered by a new component test.
- The test `counts a brief that carries the draft-time interactive default as current`
  passes. **Real cause of the original failure:** the test's own brief fixture was
  rejected by `MediaBriefSchema` (`refinedAt`/`figures`/`tables` missing and
  `video.status: "planned"` invalid), so `readMediaBrief` returned null and the
  chapter fell back to unmade intents. `realisedVisuals` was correct; the fixture was
  fixed and the expected path corrected to `../assets/routes.svg` (the note-relative
  value `realisedVisuals` returns).

## Part B — unknown licences allowed, credited and linked

- `media.allowUnknownLicense` (default **true**) sits next to
  `media.allowNonCommercial` in `shared/src/schemas.ts` and is documented in
  `docs/DEPLOY.md`. `MediaLicensePolicy`/`embeddableLicense`/`licenseLabel` live in
  `server/src/ingest/image-license.ts`.
- **Licence as stated.** `licenseLabel` now returns any non-empty stated licence
  unchanged (`"all rights reserved"` included); only a missing/blank licence becomes
  `"Licence unknown"`. Checker, `save_asset` credit and docs follow.
- **Unmodified evidence.** While `allowUnknownLicense` is true, every non-permissive
  embed (unknown, all-rights-reserved, NC and ND) must have `unmodified: true` and a
  `sha256` matching the saved bytes; ND keeps that requirement even when the setting
  is false, and ordinary NC under the older `allowNonCommercial` path is unchanged.
  Missing creator-when-known, missing licence label, and missing source link still
  block. `save_asset` always writes `sha256` + `unmodified: true` for these cases.
- Reader and book print the credit under the image with the source URL as a real link,
  exactly once. `rehypeDedupeCredits` drops a repeated reader paragraph; the book
  converts the credit's trailing URL into Markdown `[url](url)` so Pandoc emits a
  `Link` (verified against the Pandoc JSON AST) and drops the drafter's duplicated
  line. A focused `book-job` test asserts both.
- Skills (`draft-chapter`, `media-authoring`, `make-visual`, `plan-set`) prefer the
  real image and redraw as SVG only for schematic or poor images. They now state that
  `media.allowNonCommercial` only matters when `allowUnknownLicense` is false (and
  that ND always needs the original bytes/hash); the capture credit no longer says
  "(reuse license unknown; redraw)". `image-plan` no longer steers with
  licence-only wording ("licensed candidate", "no relevant licensed image").
  `docs/decisions/LOG.md` gains **D38** (supersedes D37's unknown-licence rule),
  `docs/STUDY_TREE.md` documents `licenseLabel` and the new rules, and skill changes
  were re-registered with `node scripts/skill-history.mjs`.

## Part C — limits

Full inventory with baseline file:line, value, reason and disposition:
`docs/plans/m16-evidence/limits.md` (53 rows). Summary:

- **Removed (content-only):** figures per source (`slice(0, 12)`), the 50-candidate
  page-image caps (`images.ts` ×2, `web.ts` ×2), the first-6 figures/first-2 tables,
  the 24-figure/8-table stored-brief caps, and the capture admission gate that
  required non-empty labels **and** page-word overlap. Labels/overlap now only order
  the queue; decorative/unsafe/tiny filters remain.
- **Raised:** `MAX_IMAGE_BYTES` 5 MB → 25 MB; tiny-image filter 64 px → "larger side
  < 100 px" for decoded figures and "both known dimensions < 100 px" for `<img>`;
  brief schema caps `.max(24)`→`.max(400)` and `.max(8)`→`.max(50)`; book image copy
  10 MB → 25 MB; per-set assets quota 50 MB → 500 MB. The schema caps are sanity
  ceilings only — the 5 KB prompt budget does the selection — and a chapter exceeding
  400 relevant figures would still be rejected by validation rather than silently
  truncated.
- **Kept:** SSRF guard/timeouts, MIME allow-list, path confinement/symlink checks,
  locks, 6000×6000 px, 300 KB SVG/HTML/visual-JSON, 5 KB media-brief budget,
  `visuals ≤ 20`, `evidence ≤ 2`, `images ≤ 3`, lean-field truncation
  (alt 160 / caption 300 / section 120 / credit 300 / table 400 / video reason 300 /
  image reason 180 / title 120 / creator 180), bounded brief/evidence reads
  (100 000 bytes, 2 MB, 200 files), unlabeled-source sanitization guards, PDF
  (2000 pages / 20 M chars), EPUB (200 MB / 5000 entries / 2000 spine), DOCX 100 MB,
  MinerU 64 MB, book 200 chapters / 5 MB markdown / 50 MB PDF / 120 s build,
  YouTube 512 KB transcript + 5 MB download, 8 image candidates per slot, and the
  ≤3 `Image:` plan slots. The 50 KB/40 KB parsed-split sizes keep every byte (one
  `parsed.md` plus parts), so they stay.
- Brief selection scores scope (3), visual intents (3), title (2) and video (1),
  then favors concepts not yet represented (new-concept score + one quarter of
  total relevance). Figures and tables compete for the same 5 KB budget; an
  oversized candidate is skipped so smaller useful evidence can still fit. `collectChapterMediaCandidates` in `server/src/jobs/media-plan.ts` is the
  single production helper used by both the refinement job and the trial.

## Verification (scoped)

Exact commands, counts and status are in
`docs/plans/m16-evidence/validation.json`. Final results:

| Command | Result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/ingest src/tree src/jobs src/course src/agent/builtins/save-asset.test.ts src/agent/figure-reuse.test.ts src/agent/tools.test.ts src/routes/today.test.ts src/today` | 56 files, **486 passed, 0 failed** |
| `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts src/media.test.ts` | 2 files, **56 passed** |
| `pnpm --filter @studium/web exec vitest run src/components/ChapterMediaStatus.test.tsx src/components/CoursePlan.test.tsx src/components/Activity/ActivityPanelContent.test.tsx src/components/Practice/QuizRunner.test.tsx src/components/Practice/TeachBackTab.test.tsx src/components/Reader/ChapterVisuals.test.tsx src/components/Reader/NoteImage.test.tsx src/pages/PlanPage.test.tsx src/pages/SetHomePage.test.tsx src/pages/TodayPage.test.tsx` | 10 files, **38 passed** (14 consecutive passes after the final edits; two intermittent failures were observed earlier in the cycle) |
| `pnpm --filter @studium/server exec tsc --noEmit` | passed (also after root integration) |
| `pnpm --filter @studium/web exec tsc --noEmit` | passed |
| `pnpm --filter @studium/shared exec tsc --noEmit` | passed |
| `pnpm --filter @studium/web build` | passed (existing large-chunk warning) |
| `rtk proxy pnpm exec biome check <exact filenames in validation.json>` | Final 62 supported changed files passed; generated skill registry formatted without changing hashes |

Pre-existing/known failures left untouched (exact ids in `validation.json`):
`server/src/agent/roles.test.ts` "gives the tutor a bounded course summary…"
(`roles.test.ts:348`, fails at baseline); the three `ActivityIndicator.test.tsx`
sheet/portal tests and `ChapterVisuals.test.tsx` "switches chapter views…", which
also fail at baseline in the full-suite run and are intermittent under parallel load.
No full suite was run in this correction cycle.

Final root integration checks (new compaction logic, same scope):

- `pnpm --filter @studium/server exec vitest run src/tree src/jobs src/course` —
  **29 files, 287 passed, 0 failed**. Together with the earlier disjoint ingest/
  agent/Today checks and the search tests below, the final server scope covers
  **493 distinct passing tests**.
- `pnpm --filter @studium/server exec vitest run src/search/images.test.ts` —
  **1 file, 6 passed, 0 failed**.
- `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts -t 'prints an image credit source URL'`
  — **1 passed, 20 skipped**, including source URLs containing parentheses.
- `pnpm --filter @studium/server exec tsx scripts/m16-figure-selection.ts /tmp/studium-m16-TEzRaa/tree`
  — production deterministic refinement passed without LLM/network calls.
- The concept-coverage regression and the parenthesized book-link assertion each
  failed before their fixes and passed afterward; no unrelated failures were fixed.

## Trial (temp copy of `data/users/<username>`)

Tree copy `/tmp/studium-m16-TEzRaa/tree`. A read-only localhost API
(`server/scripts/m16-browser-api.ts`, real `createApp`, GET only) plus the built
`web/dist` was driven by headless Chrome at 390 px. Processes were stopped; no
strays remain. `docs/plans/m16-evidence/browser-results.json` records:

| Check | Measured |
| --- | --- |
| Set rows | `1 Atoms, molecules…`, `2 Bonds and simple…`, `3 Carbon structures…` |
| Chapter 1 Reading panel | eyebrow `Chapter 1`, visible, 7 064 chars |
| Chapter 1 Visuals panel | eyebrow `Chapter 1`, visible, 187 chars (empty-state text, not blank) — reached by real CDP tab clicks |
| Chapter 2 Visuals panel | eyebrow `Chapter 2`, visible, 403 chars with the realised widget — real CDP tab click |
| Plan ch02 | `Pictures in text: 2/2 made · Visuals tab: 1/1 made` |
| Plan ch03 | `Pictures in text: 2/2 made · Visuals tab: 0/1 made` |
| Runtime | 0 page exceptions, no horizontal overflow |

Screenshots (390 px):

- `docs/plans/m16-evidence/390-polymers-set-numbered-rows.png`
- `docs/plans/m16-evidence/390-polymers-chapter-1-reading.png`
- `docs/plans/m16-evidence/390-polymers-chapter-1-visuals.png`
- `docs/plans/m16-evidence/390-polymers-chapter-2-visuals.png`
- `docs/plans/m16-evidence/390-polymers-plan-chapter-02.png`
- `docs/plans/m16-evidence/390-polymers-plan-chapter-03.png`

### Deterministic brief refinement — "Carbon structures and reactive groups"

`server/scripts/m16-figure-selection.ts` now calls the production
`collectChapterMediaCandidates` (subject + interactive fallback, figure/table
collection, ranking, per-visual evidence) and the production `leanMediaBrief`,
reusing the chapter's saved video/image choices; no LLM or network. Evidence:
`docs/plans/m16-evidence/carbon-structures-selection.json`.

- Subject `science`; fallback added the third visual
  `step-through — Carbon structures and reactive groups`.
- 139 source figures collected; 15 candidate tables; brief = **2 figures + 2 tables +
  3 visuals (2 evidence each), 4 962 JSON bytes (both YAML and JSON remain ≤5 KB)**.
- Before (old first-six prompt): thermal transitions, AFM polymer chains, styrene
  polymerization, phase diagram, generic polymers, DNA double helix.
- After (brief): condensed structural formulas and line-bond structures;
  the table `functional-groups-with-carbon-carbon-multiple-bonds` ("Functional
  Groups with Carbon–Carbon Multiple Bonds") and the morphology table excerpt.
  Thermal-transition and DNA figures are absent. The final integration fix favors
  new chapter concepts over repetitive drawing figures, preserving functional-group
  evidence without increasing the prompt budget. The full candidate list stays in
  the evidence file.


## Changed files

- `docs/DEPLOY.md` — Documents D38 settings and unmodified-image policy.
- `docs/STUDY_TREE.md` — Documents sidecars, limits, relevance selection and chapter numbering.
- `docs/decisions/LOG.md` — Adds D38, superseding unknown-licence exclusions.
- `docs/plans/2026-10-06-m16-chapters-media-report.md` — Records implementation, exact checks, trial and deviations.
- `docs/plans/2026-10-06-m16-chapters-media.md` — Records approved contracts, workflow, recovery and acceptance.
- `docs/plans/m16-evidence/390-polymers-chapter-1-reading.png` — Records the named 390 px trial screen.
- `docs/plans/m16-evidence/390-polymers-chapter-1-visuals.png` — Records the named 390 px trial screen.
- `docs/plans/m16-evidence/390-polymers-chapter-2-visuals.png` — Records the named 390 px trial screen.
- `docs/plans/m16-evidence/390-polymers-plan-chapter-02.png` — Records the named 390 px trial screen.
- `docs/plans/m16-evidence/390-polymers-plan-chapter-03.png` — Records the named 390 px trial screen.
- `docs/plans/m16-evidence/390-polymers-set-numbered-rows.png` — Records the named 390 px trial screen.
- `docs/plans/m16-evidence/browser-results.json` — Records visible chapter numbers/counts and browser measurements.
- `docs/plans/m16-evidence/carbon-structures-selection.json` — Records the final production-equivalent figure/table selection.
- `docs/plans/m16-evidence/limits.md` — Inventories 53 baseline limits with values, reasons and dispositions.
- `docs/plans/m16-evidence/validation.json` — Records exact verification commands, results and deviations.
- `server/scripts/m15-images-trial.ts` — Removes unknown-licence redraw steering.
- `server/scripts/m16-browser-api.ts` — Serves a GET-only temporary workspace API.
- `server/scripts/m16-chapters-media-browser.mjs` — Captures 390 px screens with real tab input and stable-panel waits.
- `server/scripts/m16-figure-selection.ts` — Trials production deterministic refinement without LLM/network.
- `server/src/agent/builtins/save-asset.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/agent/builtins/save-asset.ts` — Saves policy-aware credited images with provenance and larger limits.
- `server/src/agent/figure-reuse.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/agent/figure-reuse.ts` — Checks policy, visible credits and required unmodified-file hashes.
- `server/src/agent/tools.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/course/build.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/course/build.ts` — Accepts fallback briefs and reports missing/interactive visuals honestly.
- `server/src/ingest/figures.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/ingest/figures.ts` — Captures all content figures without semantic admission limits.
- `server/src/ingest/image-bytes.ts` — Raises raster size to 25 MB and defines the tiny-image threshold.
- `server/src/ingest/image-license.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/ingest/image-license.ts` — Implements settings and preserves stated licence labels.
- `server/src/ingest/images.ts` — Removes candidate-count limits; retains decoration/tiny filters.
- `server/src/ingest/library.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/ingest/web.ts` — Retains every discovered image candidate.
- `server/src/jobs/book-assemble.ts` — Numbers printable chapter headings.
- `server/src/jobs/book-job.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/jobs/book-media.ts` — Copies larger images and prints one linked credit, including parenthesized URLs.
- `server/src/jobs/image-plan.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/jobs/image-plan.ts` — Selects real images under the configured policy.
- `server/src/jobs/ingest-job.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/jobs/media-plan.ts` — Shares deterministic candidate/evidence refinement with the trial.
- `server/src/routes/today.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/search/images.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/search/images.ts` — Ranks candidates under D38 settings.
- `server/src/today/build.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/today/build.ts` — Numbers next-chapter suggestions from the curriculum.
- `server/src/tree/media-brief.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/tree/media-brief.ts` — Raises schema ceilings and selects diverse relevant media within 5 KB.
- `server/src/tree/media.ts` — Raises the per-set media quota to 500 MB.
- `server/src/tree/read.test.ts` — Updates focused chapter/media tests and affected fixtures.
- `server/src/tree/read.ts` — Assigns chapter numbers using curriculum identity.
- `server/templates/book/callouts.lua` — Deduplicates note titles beneath numbered book headings.
- `shared/src/api.ts` — Adds plan-derived chapter numbers and interactive media flags.
- `shared/src/schemas.ts` — Defaults media.allowUnknownLicense to true.
- `skills/.defaults-history.json` — Registers changed default skill hashes.
- `skills/draft-chapter/SKILL.md` — Prefers real images with D38 credit and unmodified-file rules.
- `skills/make-visual/SKILL.md` — Prefers real images with D38 credit and unmodified-file rules.
- `skills/media-authoring/SKILL.md` — Prefers real images with D38 credit and unmodified-file rules.
- `skills/plan-set/SKILL.md` — Prefers real images with D38 credit and unmodified-file rules.
- `web/src/components/Activity/ActivityPanelContent.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/components/Activity/ActivityPanelContent.tsx` — Resolves chapter numbers in cross-set job rows.
- `web/src/components/AppSidebar/AppSidebar.tsx` — Numbers notes and drafting rows.
- `web/src/components/ChapterMediaStatus.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/components/ChapterMediaStatus.tsx` — Separates Pictures in text and Visuals tab counts.
- `web/src/components/CoursePlan.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/components/Practice/ProblemsTab.tsx` — Numbers saved problem-set choices.
- `web/src/components/Practice/QuizTab.tsx` — Numbers quiz chapter choices.
- `web/src/components/Practice/common.tsx` — Numbers note-picker labels.
- `web/src/components/Reader/ChapterVisuals.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/components/Reader/MarkdownView.tsx` — Applies credit deduplication before sanitization.
- `web/src/components/Reader/NoteImage.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/components/Reader/NoteImage.tsx` — Displays linked image credits.
- `web/src/components/Reader/Reader.tsx` — Shows Chapter N above both reader-tab titles.
- `web/src/components/Reader/remarkStudium.ts` — Deduplicates repeated credit paragraphs.
- `web/src/lib/chapter-label.ts` — Formats numbered planned chapters and plain unplanned titles.
- `web/src/pages/CardsPage.tsx` — Numbers chapter labels on card rows.
- `web/src/pages/PlanPage.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/pages/SetHomePage.test.tsx` — Updates focused chapter/media tests and affected fixtures.
- `web/src/pages/SetHomePage.tsx` — Numbers notes and drafting placeholders without order fallback.

## Deviations

1. `git apply /path/to/studium/.worktrees/m16-partial.patch` failed with
   `No valid patches in input` (annotated snippets; line 13). Edits were
   reconstructed from the real code, as the root plan instructed.
2. The previous cycle ran the full web and shared suites and a `git stash` baseline
   check. Both violate the scoped-test policy and the preserve-work rule; this
   correction cycle ran only the explicit paths above and did not repeat either.
3. The interrupted run ended with a Command Code provider HTTP 400
   `invalid_request_error`; work resumed from the existing files on the same pinned
   route. Runtime provider routing remains upstream-unverified from the worker.
4. The browser trial uses a read-only localhost API over a temp copy (GET only)
   rather than a logged-in server; nothing in the copy could be written.
5. Chapter 1 has no realised Visuals-tab attachment, so its Visuals tab shows the
   eyebrow, title and empty state; the populated Visuals tab is demonstrated on
   chapter 2 instead. Both are reached with real CDP tab clicks.
6. Pre-existing failures (server `roles.test.ts`; web `ActivityIndicator` ×3 and the
   intermittent `ChapterVisuals` "switches chapter views…") were left untouched.

## Five-line proposed AGENT_MEMORY log (not applied)

1. 2026-10-06 M16/m16-chapters-media: chapter numbers come from curriculum identity (`NoteSummary.number`), shown on set/sidebar/reader-both-tabs/Today/Practice/Cards/drafting/Activity and as `Chapter N · Title` in the book; honest `Pictures in text / Visuals tab` counts.
2. `media.allowUnknownLicense` (default true, D38) embeds unknown/ARR/NC/ND images unmodified with creator + the licence as stated (or "Licence unknown") + source link; under the allowance every non-permissive embed needs `unmodified: true` + matching `sha256`, missing credit/source still blocks, and ND keeps the hash check when the setting is off.
3. Capture takes every non-decorative figure (labels only order it; skip logos/icons/ads/tracking/tiny), 25 MB limits, 500 MB quota; brief figures/tables favor relevant new concepts within the 5 KB budget via the shared `collectChapterMediaCandidates`.
4. Gotcha: `MediaBriefSchema` rejects a fixture missing `refinedAt`/`figures`/`tables` or with `video.status: "planned"`; the book needs the credit URL as a Markdown link or Pandoc emits a bare `Str`, and `callouts.lua` strips `Chapter N · ` when deduping titles.
5. Verified (scoped): server 493 distinct passing tests (final tree/jobs/course 287/287), shared 56/56, web 38/38 explicit paths, three tsc, web build, biome final changed-file lint; trial screenshots + selection/validation evidence in `docs/plans/m16-evidence/`.
