# M14b follow-up — spatial visuals and book regressions

Synced `codex/m14b` with `git merge --ff-only main` (39a4176 → 9c18ca0).
No commits, pushes, branch changes, live-data writes or provider calls.

Changed files:

- `shared/src/visuals/step-through.ts` — optional parallel `positions: [[x,y],…]` per step; finite 0–1 coordinates, exactly one pair per item. Centers map to x=56+528x, y=40+280y. Shared layout serves the app, static SVG and book stills; omitted positions preserve legacy layout.
- `shared/src/visuals/widgets.test.ts` — ethane/ethene connectivity checks for crossing bonds and SVG coordinates; invalid positions and legacy layout checks.
- `server/src/jobs/book-job.test.ts` — curriculum/chapter-id ordering with renamed files and contradictory old order values; valid SVG posters and explicit five-image assertions; positioned molecule book-still regression.
- `skills/make-visual/SKILL.md` — explicit positions required for molecules, structures, maps and spatial diagrams; circle only for cycles; SVG sketch guidance for multiple bonds.
- `skills/make-visual/references/widgets.md` — positions contract and non-crossing ethane example.
- `skills/make-visual/references/fill-slots.md` — coordinate slots and constraints.
- `skills/make-visual/references/templates/step-through-molecule.json` — complete displayed-to-condensed ethane widget with positions in both scenes.
- `skills/.defaults-history.json` — hashes for these four edited/new skill files.
- `docs/plans/m14b-followup-evidence/visuals/03-conventions.json` — regenerated chapter 03 widget; explicit positions in all four steps.
- `docs/plans/m14b-followup-evidence/visuals/03-groups.html` — regenerated slider sketch with explicit normalized atom coordinates and single/double bond strokes for six functional groups.
- `docs/plans/m14b-followup-evidence/visuals/03-groups.svg` — regenerated default poster serialized from the actual browser SVG.
- `docs/plans/m14b-followup-evidence/book-ethane-default.svg` — actual positioned default book still.
- `docs/plans/m14b-followup-evidence/{browser-results,book-results}.json` — trial evidence.
- `docs/plans/m14b-followup-evidence/390-*.png` — three 390×1000 screenshots: Visuals tab, default functional groups, ester/acid comparison.
- This report — results and handoff log.

Both book failures were fixture problems. `book-assemble.ts:100` already calls the
same `listNotes` ordering used by `course/build.ts:33`: curriculum identity/order,
then unmatched notes sorted by frontmatter order/title. The old test expected an
unplanned order-0 note first. The replacement checks course order even after a
filename change and conflicting old frontmatter numbers. No production ordering
change was necessary.

The three-versus-five failure came from the two sketch poster SVGs lacking
`viewBox`. `book-media.ts:65` validates SVG copies; `tree/media.ts:49` requires a
valid viewBox for visuals. Default + capped first/last widget scenes correctly
produced three files; invalid posters contributed zero. Valid poster fixtures now
produce the expected five files, including both sketch posters. Safety validation
and scene caps are unchanged.

Final scoped validation: **79 tests passed, zero failures** across seven files.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts src/tree/media.test.ts src/tree/skill-sync.test.ts src/agent/builtins/skills.test.ts` | 55 passed, 4 files; book-job 19 |
| `pnpm --filter @studium/shared exec vitest run src/visuals` | 14 passed, 1 file |
| `pnpm --filter @studium/web exec vitest run src/components/Reader/WidgetBlock.test.tsx src/components/Reader/ChapterVisuals.test.tsx` | 10 passed, 2 files |
| `pnpm --filter @studium/server exec tsc --noEmit` | passed |
| `pnpm --filter @studium/web exec tsc --noEmit` | passed |
| `pnpm --filter @studium/shared exec tsc --noEmit` | passed |
| `pnpm --filter @studium/web build` | passed; existing large-chunk advisory |
| `node scripts/skill-history.mjs` | completed |
| `git diff --check` | passed |

Final Biome command (Markdown/SVG are outside its configured language checks):
**Passed: 9 files checked, no fixes needed.**

```sh
rtk proxy pnpm exec biome check shared/src/visuals/step-through.ts shared/src/visuals/widgets.test.ts server/src/jobs/book-job.test.ts skills/.defaults-history.json skills/make-visual/SKILL.md skills/make-visual/references/widgets.md skills/make-visual/references/fill-slots.md skills/make-visual/references/templates/step-through-molecule.json docs/plans/2026-10-06-m14b-followup-report.md docs/plans/m14b-followup-evidence/visuals/03-conventions.json docs/plans/m14b-followup-evidence/visuals/03-groups.html docs/plans/m14b-followup-evidence/browser-results.json docs/plans/m14b-followup-evidence/book-results.json
```

The baseline book run reproduced both failures (16 passed, 2 failed); the final
book run passes all 19 tests.

Trial root: `/tmp/studium-m14b-trial-SdNjCL/tree`. Both existing chapter 03
attachments were regenerated directly on this temp copy using their existing
concepts and source-grounded examples; no new provider draft was needed.

- `03-conventions.json`: step through displayed, condensed, skeletal annotations
  and the hydrogen-count answer. Each carbon visibly connects to its own three
  hydrogens; no crossing bonds. All scenes have explicit positions.
- `03-groups.html`: slide among six groups and compare a selected group with its
  neighbor. Stable carbonyl geometry shows why ester/acid and amine/amide differ;
  real parallel strokes represent C=C and C=O. The matching SVG poster has the
  same authored geometry.
- Browser command: `node /tmp/studium-m14b-followup-browser.mjs /tmp/studium-m14b-trial-SdNjCL/tree`
  (temporary adaptation of existing `server/scripts/m14b-browser.mjs`; reduced
  motion keeps the first widget scene available for capture and default SVG is
  serialized before the slider interaction).
- Browser result: 3 checks passed, zero runtime errors, no horizontal overflow;
  native Next-scene click changed the widget and slider changed group 1 → 5.
  Sketch sandbox remains `allow-scripts`. All started browser/API processes stopped.
- Chapter-media export: 5 widget stills (default + four scenes), 1 sketch poster,
  plus 2 inline SVGs. All three edited visual files pass media validation; exported
  ethane centers match the shared layout. Output:
  `/tmp/studium-m14b-followup-book-giXgBy`.

Screenshot: [390 px Visuals tab](m14b-followup-evidence/390-visuals-tab.png).
Additional [default groups](m14b-followup-evidence/390-functional-groups-default.png)
and [ester/acid comparison](m14b-followup-evidence/390-functional-groups-compared.png).

Usage: Exa $0 / 0 calls. Application LLM providers: 0 calls / 0 tokens / $0
each; no subscription-provider loop occurred. Root Codex token billing is not
exposed by this session's tools. No remaining requested work; live chapter files
stay untouched, with reviewable regenerated copies in the evidence folder.

Five-line log entry for the orchestrator:

```text
2026-10-06 M14b follow-up: synced main by fast-forward; no commit/push or live-data writes.
Step-through supports validated normalized per-step positions shared by app/SVG/book; old specs retain layout.
make-visual requires authored spatial geometry; added complete ethane template and updated skill hashes.
Fixed stale book ordering/poster fixtures; 79 scoped tests, three tsc checks, web build and Biome pass.
Temp chapter 03 regenerated; 390px native-browser checks and six interactive book stills verified; Exa/providers $0.
```
