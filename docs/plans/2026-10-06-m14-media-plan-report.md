# M14 implementation report

## Phase 1 — planner and format

Added optional repeated `Visual:` and single `Video:` curriculum lines, preserving legacy and fence-aware parsing. Course API exposes chapter media intent. Planner now requests 1–2 visuals and a quality video per chapter, with an explicit no-suitable-video reason rather than a quota filler.

Validation: `pnpm --filter @studium/server exec vitest run src/course/build.test.ts` — 4 passed.

## Phase 2 — source figures

Raster validation is shared with save_asset. Capture stages up to 12 relevant figures, checks HTTPS/SSRF/size/type/dimensions, records explicit licenses and credit, and skips decorative/tracking images. Ingest and refresh publish images.json v2 while legacy metadata remains readable.

## Phase 3 — briefs and per-chapter video scouting

Added tracked YAML/Markdown briefs with intent, relevant credited figures, candidate source tables, and chosen video/observed transcript moment or no-suitable-video reason. Kickoff schedules media refinement as an AI-gated `plan-set` job, outside the ingest wait, then drafts. Draft and rewrite preflight reuses/refines the brief. Quality selection uses the existing M13 video router, scout ranking and transcript ladder; watch-only video remains claim-ineligible.

Validation: fake-model/video selection tests and kickoff sequencing/restart tests pass (commands below). No new dependencies or job kinds.

## Phase 4 — drafting and checking

The brief is delimited untrusted data in draft/rewrite/revision/checker tasks. Hidden per-visual markers associate each intent with an actual attachment; explicit omissions need a reason and muted learner-facing explanation. Write-time media warnings flag unknown/restrictive source figure reuse (including copied known bytes); checked status enforces omissions and reuse alongside existing video/teaching checks.

Validation: `pnpm --filter @studium/server exec vitest run src/tree/media-brief.test.ts src/agent/figure-reuse.test.ts src/inbox/plan-kickoffs.test.ts src/jobs/draft-job.test.ts` — 35 passed.

## Phase 5 — visible media and documentation

Course plan and Plan rows share compact wrapping media status: made/planned visuals, intents, chosen video title/channel/moment, or explicit absence reason. Updated study-tree contract, D36, four authoring/planning skills and defaults history.

Validation: `pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx src/pages/PlanPage.test.tsx` — 12 passed. Required scoped tests, package types and web build completed (results below).

## Phase 6 — real trial

Refresh copy: `/tmp/studium-m14-refresh-6qwukm`. All source metadata and figure counts are recorded in its `m14-refresh-results.json`. The new trial script copies that tree again, retains the owner's Exa spend estimate, uses subscription-only `evalRuntime` with its repeated-failure loop guard, and runs real plan/approval/kickoff/media/draft for polymers and Hyderabad history. Production data stays read-only; credentials enter solely through Node `--env-file`.

### Refresh figures captured per source

| Source | Result | Local figures | Candidates |
| --- | --- | ---: | ---: |
| lib-akdn-india-restoration-in-hyderabad-akdn | refreshed | 2 | 2 |
| lib-asml-how-microchips-are-made-asml | refreshed | 12 | 12 |
| lib-asml-lithography-principles-technology-asml | refreshed | 9 | 9 |
| lib-behaviors-deepseek-conditional-memory-via | unchanged | 0 | 0 |
| lib-cambridge-beyond-colonial-urbanism-state | refreshed | 0 | 1 |
| lib-cambridge-princely-cities-in-south-asia-c | refreshed | 0 | 1 |
| lib-cheng-conditional-memory-via-scalable-lookup | refreshed | 0 | 0 |
| lib-colorado | refreshed | 2 | 2 |
| lib-computerhistory-welcome-the-silicon-engine | refreshed | 2 | 2 |
| lib-en-wikipedia-org-singular-value | refreshed | 5 | 5 |
| lib-incredibleindia-famous-places-to-explore-in | refreshed | 12 | 12 |
| lib-libretexts-polymer-chemistry-schaller | refreshed | 6 | 6 |
| lib-lse-the-integration-of-the-princely-state | refreshed | 1 | 1 |
| lib-openstax-ch-20-introduction-chemistry-2e | refreshed | 0 | 0 |
| lib-openstax-physics-free-college-textbook | refreshed | 0 | 0 |
| lib-smashers-language-modeling-in-n-gram-nlp | unchanged | 0 | 0 |
| lib-strang-la | skipped | 0 | 0 |
| lib-unesco-monuments-and-forts-of-the-deccan | refreshed | 0 | 1 |
| lib-unesco-the-qutb-shahi-monuments-of-hyderabad | refreshed | 0 | 1 |
| lib-wikipedia-history-of-hyderabad | refreshed | 11 | 12 |
| lib-wikipedia-hyderabad-state | refreshed | 12 | 12 |
| lib-wikipedia-polymer | refreshed | 12 | 12 |
| lib-wikipedia-principal-component-analysis | refreshed | 7 | 7 |

Total: 93 local figures across 23 sources. Refresh Exa requests/spend: 0/$0; model usage: 0. Failed image downloads keep metadata without claiming a local file.

### Required scoped validation

- `pnpm --filter @studium/server exec vitest run src/ingest/ src/search/ src/tree/ src/jobs/ src/course/build.test.ts src/inbox/plan-kickoffs.test.ts src/inbox/plans.test.ts src/routes/inbox.test.ts src/agent/figure-reuse.test.ts src/agent/tools.test.ts src/agent/builtins/save-asset.test.ts` — 480 passed, 1 pre-existing failure (60 files; 59 passed).
- Known failure: `server/src/jobs/book-job.test.ts:423`, “renders widget default and capped story scenes and sketch posters without executing HTML”: expects 5 media files, gets 3. Listed in AGENT_MEMORY.md before M14; untouched, no unrelated fix.
- `pnpm --filter @studium/server exec tsc --noEmit` — passed.
- `pnpm --filter @studium/web exec tsc --noEmit` — passed.
- `pnpm --filter @studium/shared exec tsc --noEmit` — passed.
- `pnpm --filter @studium/web build` — passed; existing >500 kB chunk warnings.

Review found that LibreTexts can put its explicit license in dynamic page tags rather than an ordinary anchor. Added conservative tag parsing, retaining NC/ND restrictions. The actual Schaller material states CC BY-NC (not unrestricted CC BY), so its unknown/restrictive figures require redraws: [LibreTexts Monomers and Polymers](https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Polymer_Chemistry_%28Schaller%29/01%3A_Monomers_and_Polymers). This is a detected permission boundary, not a blanket license inferred from the host.

Follow-up validation: `pnpm --filter @studium/server exec vitest run src/agent/builtins/save-asset.test.ts src/tree/media-brief.test.ts src/jobs/media-plan.test.ts src/agent/figure-reuse.test.ts` — 11 passed. This includes no-network copying of a captured licensed raster into set assets, with credit and symlink rejection. `save_asset` now prefers captured bytes when sourceId/URL match.

Final-code follow-ups: `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts src/jobs/media-plan.test.ts src/tree/media-brief.test.ts src/agent/figure-reuse.test.ts src/ingest/figures.test.ts` — 38 passed in 5 files. Includes clean-report checked-status refusal for both omitted visuals and restrictive figure reuse, fallback to curriculum requirements without a current brief, and Commons thumbnail per-file license/artist lookup. An initial Commons test import failed because Cheerio is not installed; corrected to the existing LinkeDOM dependency, with no dependency changes.

The final-code targeted Refresh used `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/m14-figures-refresh.ts /tmp/studium-m14-refresh-6qwukm lib-wikipedia-polymer,lib-wikipedia-history-of-hyderabad,lib-wikipedia-hyderabad-state,lib-libretexts-polymer-chemistry-schaller`. Evidence: `/tmp/studium-m14-refresh-k17fLA/m14-refresh-results.json`. Polymer: 12 local, 4 explicit reusable per-file licenses (including AliceChem CC BY-SA 4.0 and Yurko CC BY-SA 3.0). Hyderabad history: 11 local, 4 explicit reusable per-file licenses. Hyderabad State: HTTP 429 at the Wikipedia API; retained all 12 prior local figures/metadata. Schaller book index: 6 local, license unknown there; redraw required. Other per-file metadata requests stayed unknown when unavailable; permission is never inferred. Exa/model usage remained zero for Refresh.

Trial review found that the checker cannot load the drafter-only `media-authoring`/`make-visual` skills (`server/src/agent/roles.ts:126`, checker.skills). Stopped asking the checker to load them; it receives the explicit media requirements and delimited brief directly. Drafter and rewrite/revision retain their skill instruction, including the shallow-rewrite revision path. No role/tool allowlist was expanded.

Final permission/extraction follow-up: `pnpm --filter @studium/server exec vitest run src/ingest/web.test.ts src/ingest/figures.test.ts src/ingest/library.test.ts src/ingest/refresh.test.ts` — 26 passed in 4 files. Individual figure license/caption credit overrides the page license; a single figure's CC link never licenses its neighbours. Explicit restrictive LibreTexts tags take priority over general links, and unavailable Commons metadata never falls back to the source page's prose license.

First browser pass: `node server/scripts/m14-browser.mjs /tmp/studium-m14-trial-lpIKg1/tree` — 8 rows/pages at 390/1440 px, no horizontal overflow or runtime exceptions, using the real course API with only session identity stubbed. This pass captured polymers complete and Hyderabad still planned. Reviewing the PNGs revealed fixed mobile navigation over the cropped row; the capture script now scrolls with actual wheel input before the final screenshots. Visual unavailability text now reuses the muted learner-facing explanation rather than exposing the internal marker reason.

Additional final-code checks: `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts src/ingest/figures.test.ts` — 31 passed; `pnpm --filter @studium/server exec vitest run src/tree/media-brief.test.ts src/course/build.test.ts` — 7 passed; `pnpm --filter @studium/server exec tsc --noEmit` — passed after the license/credit and prompt changes. Regenerating skill history reformats the JSON; the required Biome formatter was reapplied to that generated file.

Final adversarial copyright check: damaged/missing figure metadata does not permit direct library-image reuse or saved source rasters, and a permissive sidecar URL cannot disguise the bytes of a known restrictive captured image. `pnpm --filter @studium/server exec vitest run src/agent/figure-reuse.test.ts src/jobs/draft-job.test.ts` — 30 passed in 2 files. No suitable-video selections also reject blank reasons; `pnpm --filter @studium/server exec vitest run src/jobs/media-plan.test.ts` — 2 passed. Future no-video explanations are explicitly requested as short learner-facing reasons.

Final-code real captured-raster check: `pnpm --filter @studium/server exec node --import tsx /tmp/m14-real-raster.mts` — passed. Copied the actual captured thermal-transition PNG from `lib-wikipedia-polymer` to set assets; checker returned no warnings with the named author, license and source citation. No network/model calls were made. [Captured copy](m14-media-plan-evidence/permitted-polymer-figure.png) and [credit sidecar](m14-media-plan-evidence/permitted-polymer-figure.json). Credit: AliceChem, [Thermal transitions in amorphous and semicrystalline polymers](https://commons.wikimedia.org/wiki/File:Thermal_transitions_in_amorphous_and_semicrystalline_polymers.tif), CC BY-SA 4.0. This was a separate final-code asset verification; it was not inserted into either model-authored trial chapter.

### Real plan, kickoff, media and draft results

Evidence tree: `/tmp/studium-m14-trial-lpIKg1/tree`. Run command: `pnpm --filter @studium/server exec node --env-file=/path/to/studium/.env --import tsx scripts/m14-media-trial.ts /tmp/studium-m14-refresh-6qwukm`.

The complete trial ran on a temp copy with real subscription models, actual proposal approval and persisted kickoff, M13 search and the transcript ladder. No fixed call cap; the existing three-identical-failures guard stayed enabled. Trial snapshots below include only authored plan/media/note artifacts, without workspace configuration or credentials.

**polymers** — 8 planned chapters, 8 refined briefs; first chapter status `draft`. Draft job: Finished with open blocker issues.

Draft snapshot: [01-from-familiar-materials-to-atoms-and.md](m14-media-plan-evidence/polymers/notes/01-from-familiar-materials-to-atoms-and.md). Realised markers: visual-1; explained omissions: visual-2: the available foundation text is a catalog record; no verified mixture definition or particle-picture evidence is present in the supplied teaching passages.

| Chapter / saved brief | Video title and channel | URL | Moment / result |
| --- | --- | --- | --- |
| [From familiar materials to atoms and molecules](m14-media-plan-evidence/polymers/media/01-from-familiar-materials-to-atoms-and.md) | Elements and atoms \| Atoms, compounds, and ions \| Chemistry \| Khan Academy — Khan Academy | [Watch](https://www.youtube.com/watch?v=IFKnq9QM6_A) | Watch-only; no transcript or invented moment |
| [Bonds inside molecules, attractions between them](m14-media-plan-evidence/polymers/media/02-bonds-inside-molecules-attractions.md) | Hydrogen bonding \| AP Chemistry \| Khan Academy — Khan Academy | [Watch](https://www.youtube.com/watch?v=ltxqQbiI6-o) | Watch-only; no transcript or invented moment |
| [Reactions and counting molecules](m14-media-plan-evidence/polymers/media/03-reactions-and-counting-molecules.md) | Stoichiometry - Chemistry for Massive Creatures: Crash Course Chemistry #6 — CrashCourse | [Watch](https://www.youtube.com/watch?v=UL1jmJaUkaQ) | Watch-only; no transcript or invented moment |
| [Carbon's building blocks](m14-media-plan-evidence/polymers/media/04-carbon-s-building-blocks.md) | GCSE Chemistry Revision "Amino Acids" (Triple) — freesciencelessons | [Watch](https://www.youtube.com/watch?v=JU1-HApRymY) | Watch-only; no transcript or invented moment |
| [Monomers, repeat units and long chains](m14-media-plan-evidence/polymers/media/05-monomers-repeat-units-and-long-chains.md) | From DNA to Silly Putty: The diverse world of polymers - Jan Mattingly — TED-Ed | [Watch](https://www.youtube.com/watch?v=UwRVj9rz2QQ) | Watch-only; no transcript or invented moment |
| [Two ways to build polymers](m14-media-plan-evidence/polymers/media/06-two-ways-to-build-polymers.md) | GCSE Chemistry - Condensation Polymers (Polyesters) (2026/27 exams) — Cognito | [Watch](https://www.youtube.com/watch?v=U-eCXeFwTgY) | Watch-only; no transcript or invented moment |
| [Why a bag, bottle and rubber band behave differently](m14-media-plan-evidence/polymers/media/07-why-a-bag-bottle-and-rubber-band-behave.md) | The Polymer Explosion: Crash Course Engineering #20 — Crash Course | [Watch](https://www.youtube.com/watch?v=XjDDHnByfuo) | Watch-only; no transcript or invented moment |
| [Lifetime, recycling and a material-choice capstone](m14-media-plan-evidence/polymers/media/08-lifetime-recycling-and-a-material.md) | Confused about recycling? It’s not your fault - Shannon Odell — TED-Ed | [Watch](https://www.youtube.com/watch?v=_EF4LXLxquM) | Watch-only; no transcript or invented moment |

**hyderabad-history** — 12 planned chapters, 12 refined briefs; first chapter status `checked`. Draft job: Chapter checked.

Draft snapshot: [01-hyderabad-on-the-map-and-timeline.md](m14-media-plan-evidence/hyderabad-history/notes/01-hyderabad-on-the-map-and-timeline.md). Realised markers: visual-1, visual-2; explained omissions: none.

| Chapter / saved brief | Video title and channel | URL | Moment / result |
| --- | --- | --- | --- |
| [Hyderabad on the Map and Timeline](m14-media-plan-evidence/hyderabad-history/media/01-hyderabad-on-the-map-and-timeline.md) | Hyderabad in the Early 20th Century \| Anuradha Naik \| TEDxVNRVJIET — TEDx Talks | [Watch](https://www.youtube.com/watch?v=G5xEgqG2HrA) | Watch-only; no transcript or invented moment |
| [Before Hyderabad: Deccan and Golconda](m14-media-plan-evidence/hyderabad-history/media/02-before-hyderabad-deccan-and-golconda.md) | No suitable video | — | No evaluated candidate meets score >=4 for a beginner English expert Golconda walkthrough. Exa, SearXNG and a targeted retry returned mostly unverified travel videos or Hindi narration. Discovery India's relevant lead lacks verified English/expert treatment; the fetched George Michell/Bagri Foundation lecture concerns Early Chalukya temples rather than Golconda. Other regional educational videos do not satisfy the site-walkthrough need. Duration and captions remain unknown; no weak quota filler selected. |
| [Qutb Shahis and the Founding of Hyderabad](m14-media-plan-evidence/hyderabad-history/media/03-qutb-shahis-and-the-founding-of.md) | No suitable video | — | No verified candidate meets score >=4 for the beginner English founding/city-plan brief. Scored 10 candidates: strongest named-expert talk concerns early twentieth-century Hyderabad (3/5); others lack authority, use Hindi/Urdu, or cover later periods. Exa searches and SearXNG fallback produced an additional relevant named-speaker lead, Salma A. Farooqui, but its description says only a glimpse of a lecture; fetching returned a browser-update interstitial, leaving channel, language, substantive coverage and focused-moment suitability unverified. Durations and captions remain unknown. Do not add a weak quota filler. |
| [Reading the Qutb Shahi City in Stone](m14-media-plan-evidence/hyderabad-history/media/04-reading-the-qutb-shahi-city-in-stone.md) | Aga Khan Trust for Culture \| Qutb Shahi Tombs Baolis — Aga Khan Trust for Culture | [Watch](https://www.youtube.com/watch?v=11I9hVbj2Go) | Watch-only; no transcript or invented moment |
| [Mughal Conquest and the Rise of the Nizams](m14-media-plan-evidence/hyderabad-history/media/05-mughal-conquest-and-the-rise-of-the.md) | The rise and fall of the Mughal Empire - Stephanie Honchell Smith — TED-Ed | [Watch](https://www.youtube.com/watch?v=fMsmCxIEQr4) | Watch-only; no transcript or invented moment |
| [Hyderabad State and British Paramountcy](m14-media-plan-evidence/hyderabad-history/media/06-hyderabad-state-and-british-paramountcy.md) | Restoration Projects at the British Residency, Hyderabad, Telangana — Deccan Heritage Foundation | [Watch](https://www.youtube.com/watch?v=be7h1xcF7oY) | Watch-only; no transcript or invented moment |
| [Making a Modern Capital](m14-media-plan-evidence/hyderabad-history/media/07-making-a-modern-capital.md) | Hyderabad in the Early 20th Century \| Anuradha Naik \| TEDxVNRVJIET — TEDx Talks | [Watch](https://www.youtube.com/watch?v=G5xEgqG2HrA) | Watch-only; no transcript or invented moment |
| [1947–1948: Accession, Conflict, and Memory](m14-media-plan-evidence/hyderabad-history/media/08-1947-1948-accession-conflict-and-memory.md) | No suitable video | — | No candidate reached the required 4/5 quality threshold after Exa video discovery, SearXNG YouTube retry and scoring ten candidates. Firstpost offers English archival military narration but no verified expert distinction between military events and civilian suffering. Named educational/interview leads have non-English speech or unverified language and contextualisation; other civilian-history leads lack verified authority. Durations and captions remain unknown. Choosing none rather than a weak quota filler. |
| [From Hyderabad State to Telangana](m14-media-plan-evidence/hyderabad-history/media/09-from-hyderabad-state-to-telangana.md) | SIET:10th Class(EM)\|\|SOCIAL STUDIES -THE MOMENT FOR THE FORMATION OF TELANGANA STATE (PART-1)\|\|T-SAT — T-SAT Network | [Watch](https://www.youtube.com/watch?v=yIjuJrrBKgk) | Watch-only; no transcript or invented moment |
| [A Living Deccani Culture](m14-media-plan-evidence/hyderabad-history/media/10-a-living-deccani-culture.md) | Sarmaya Talks with Yunus Lasania \| Dakhni: A language hiding in plain sight — Sarmaya Arts Foundation | [Watch](https://www.youtube.com/watch?v=_Y0jR6VnqO4) | Watch-only; no transcript or invented moment |
| [Heritage, Development, and Competing Memories](m14-media-plan-evidence/hyderabad-history/media/11-heritage-development-and-competing.md) | Sarmaya Talks with Ratish Nanda \| Qutb Shahi Necropolis: Conservation and Landscape Restoration — Sarmaya | [Watch](https://www.youtube.com/watch?v=WE97v2o3rI4) | Watch-only; no transcript or invented moment |
| [Build a History-Led Tourist Itinerary](m14-media-plan-evidence/hyderabad-history/media/12-build-a-history-led-tourist-itinerary.md) | No suitable video | — | No verified candidate meets the >=4 threshold for this chapter's specific need: an English beginner-friendly qualified guide demonstrating observation, etiquette and realistic movement between Hyderabad heritage stops. Exa video searches yielded mostly unrelated/non-English vlogs and history talks; direct SearXNG retry aborted, but scout fallback supplied YouTube leads. The fetched Siasat walk page confirms publisher/title only, not language, guide expertise or instructional coverage. The fetched Yunus Lasania page establishes relevant heritage-walk experience but is a project introduction, not verified itinerary modelling. Best scored history talks were 3/5 for chapter fit; duration and captions remain unknown. No weak filler selected. |

### Provider usage and search spend

261 model requests recorded by evalRuntime; all routed through subscription providers. No metered model provider was allowed.

| Provider | Fresh input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| openai-codex | 969,321 | 39,408 | 3,608,832 | 0 |
| github-copilot | 6,118 | 34,265 | 2,117,927 | 435,253 |

Exa: 35 requests; **$0.243 estimated spend** from job instrumentation. Temp workspace monthly ledger: $0.243; the source workspace had no Exa ledger to seed, so initial recorded spend was zero. Refresh runs used no Exa or models. SearXNG fallback is existing self-hosted routing.


### Figures used or redrawn; visual results

- Polymers: 1/2 made. Original Mermaid scale/chain diagram draws on the RSC example and Wikipedia's measured-chain caption; no source raster embedded. The particle comparison has a concrete hidden omission reason and one muted learner-facing explanation. The independent checker retained a foundation-completeness blocker after revision.
- Hyderabad: 2/2 made and checked. [Original orientation SVG](m14-media-plan-evidence/hyderabad-history/assets/hyderabad-orientation.svg) uses UNESCO monument coordinates, a north arrow and a qualified distance scale; river/lake/urban outlines are labelled schematic. [Timeline widget](m14-media-plan-evidence/hyderabad-history/visuals/hyderabad-timeline.json) cites its historical sources and separates eight landmarks/political turns. No source raster copied into the note. Four additional source ingests in preflight supplied the missing orientation evidence.
- Twenty briefs: 16 chosen videos, all honestly watch-only; 4 Hyderabad chapters have explicit no-suitable-video reasons. Real timestamps were unavailable through the transcript ladder on this host. The fake-transcript test verifies observed 30–90s anchors and refuses invented anchors.
- The separate permitted-raster check above proves the final local-copy and credit path without changing either trial chapter.

### Limits, deviations and open questions

- No scope changes or new dependencies/job kinds. Trials and Refresh wrote only temporary copies; repository commits/pushes and production changes were not performed.
- Polymers' required atoms/molecules/formulas/mixtures foundation remains incomplete. The existing lexical coverage metric showed 8/8 while the checker correctly kept this chapter as draft (`server/src/search/coverage.ts:24`). Fixing source-coverage semantics is outside M14; no unrelated change was made.
- Watch-only videos fulfil the permitted D34/E2 case but cannot support factual claims. No operator cookies or secret key files were copied into the isolated trial instance; credentials came through `--env-file`. No transcript moments are claimed for these real trials.
- Four history chapters found no verified matching educator/institution video at the requested language/level. Their explicit reasons remain in the saved briefs rather than substituting weak candidates.
- The existing book test failure remains open. Missing Strang upload and Wikipedia HTTP 429 limited Refresh items; prior data was retained. Schaller book-index figures have no explicit detected permission; the actual monomer page states CC BY-NC, so neither unknown nor restrictive material may be copied.
- The long-running model trial started before final conservative license, warning and prompt refinements. Those follow-ups passed focused tests, a real final-code Refresh/raster-copy check, and the final real-course API check. A second full model pipeline was not run. The dataset contained no symlinks; the final copier preserves symlinks so normal root-confinement checks still apply.

### Final browser results and screenshots

`node server/scripts/m14-browser.mjs /tmp/studium-m14-trial-lpIKg1/tree` — **8 passed**, no horizontal overflow or runtime exceptions at 390/1440 px, real Course/Plan APIs. Each page uses an isolated browser context so PWA reloads/event streams from earlier navigations cannot interfere; captured rows are scrolled clear of fixed navigation. No application change was needed for the fixture failure. Prior final-capture attempts failed during a service-worker reload/transport carry-over; isolated contexts resolved them.

| Subject | Mobile Course | Desktop Course | Mobile Plan | Desktop Plan |
| --- | --- | --- | --- | --- |
| Polymers | [390 px](m14-media-plan-evidence/screenshots/390-polymers-course.png) | [1440 px](m14-media-plan-evidence/screenshots/1440-polymers-course.png) | [390 px](m14-media-plan-evidence/screenshots/390-polymers-plan.png) | [1440 px](m14-media-plan-evidence/screenshots/1440-polymers-plan.png) |
| Hyderabad | [390 px](m14-media-plan-evidence/screenshots/390-hyderabad-history-course.png) | [1440 px](m14-media-plan-evidence/screenshots/1440-hyderabad-history-course.png) | [390 px](m14-media-plan-evidence/screenshots/390-hyderabad-history-plan.png) | [1440 px](m14-media-plan-evidence/screenshots/1440-hyderabad-history-plan.png) |

[Browser row text/results](m14-media-plan-evidence/screenshots/results.json), [trial outcomes/provider usage](m14-media-plan-evidence/results.json). All API/Chrome/MCP processes launched by the trial/capture scripts exited; no existing process was stopped.

## Changed files

- `docs/STUDY_TREE.md` — Documents curriculum intents, tracked briefs, local figures and realised-visual markers.
- `docs/decisions/LOG.md` — Locks D36 and the per-chapter video/reuse rules.
- `docs/plans/2026-10-06-m14-media-plan-report.md` — Phase progress, exact checks, trial outcomes, spending, limitations and handoff log.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/assets/hyderabad-orientation.svg` — Original source-cited real-trial orientation figure.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/curriculum.md` — Approved real-trial curriculum snapshot.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/log/checks/01-hyderabad-on-the-map-and-timeline.md` — Independent real-trial checker report.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/01-hyderabad-on-the-map-and-timeline.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/02-before-hyderabad-deccan-and-golconda.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/03-qutb-shahis-and-the-founding-of.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/04-reading-the-qutb-shahi-city-in-stone.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/05-mughal-conquest-and-the-rise-of-the.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/06-hyderabad-state-and-british-paramountcy.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/07-making-a-modern-capital.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/08-1947-1948-accession-conflict-and-memory.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/09-from-hyderabad-state-to-telangana.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/10-a-living-deccani-culture.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/11-heritage-development-and-competing.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/media/12-build-a-history-led-tourist-itinerary.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/notes/01-hyderabad-on-the-map-and-timeline.md` — Real model-authored first chapter snapshot.
- `docs/plans/m14-media-plan-evidence/hyderabad-history/visuals/hyderabad-timeline.json` — Source-cited real-trial timeline widget.
- `docs/plans/m14-media-plan-evidence/permitted-polymer-figure.json` — Original credit/license sidecar for the permitted captured raster.
- `docs/plans/m14-media-plan-evidence/permitted-polymer-figure.png` — CC BY-SA 4.0 captured raster used in final local-copy verification; credited above.
- `docs/plans/m14-media-plan-evidence/polymers/curriculum.md` — Approved real-trial curriculum snapshot.
- `docs/plans/m14-media-plan-evidence/polymers/log/checks/01-from-familiar-materials-to-atoms-and.md` — Independent real-trial checker report.
- `docs/plans/m14-media-plan-evidence/polymers/media/01-from-familiar-materials-to-atoms-and.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/02-bonds-inside-molecules-attractions.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/03-reactions-and-counting-molecules.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/04-carbon-s-building-blocks.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/05-monomers-repeat-units-and-long-chains.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/06-two-ways-to-build-polymers.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/07-why-a-bag-bottle-and-rubber-band-behave.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/media/08-lifetime-recycling-and-a-material.md` — Saved real-trial per-chapter media brief.
- `docs/plans/m14-media-plan-evidence/polymers/notes/01-from-familiar-materials-to-atoms-and.md` — Real model-authored first chapter snapshot.
- `docs/plans/m14-media-plan-evidence/results.json` — Trial outcomes, provider usage and Exa spending.
- `docs/plans/m14-media-plan-evidence/screenshots/1440-hyderabad-history-course.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/1440-hyderabad-history-plan.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/1440-polymers-course.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/1440-polymers-plan.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/390-hyderabad-history-course.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/390-hyderabad-history-plan.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/390-polymers-course.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/390-polymers-plan.png` — Final browser row screenshot.
- `docs/plans/m14-media-plan-evidence/screenshots/results.json` — Eight final browser results and captured row text.
- `server/scripts/m14-browser-api.ts` — Read-only real-tree API for browser checks, with session identity fixture.
- `server/scripts/m14-browser.mjs` — Native Chrome captures of Course/Plan rows, isolated PWA contexts and owned-process cleanup.
- `server/scripts/m14-figures-refresh.ts` — Temp-copy real Refresh with per-source counts and optional targeted follow-up.
- `server/scripts/m14-media-trial.ts` — Subscription-only real plan/approval/kickoff/media/draft trial and usage evidence.
- `server/src/agent/builtins/save-asset.test.ts` — Checks captured local copying, credit and symlink rejection without network calls.
- `server/src/agent/builtins/save-asset.ts` — Reuses confined captured bytes, retains named credit/license, and warns about restricted reuse.
- `server/src/agent/figure-reuse.test.ts` — Checks reuse permission, visible credit, damaged metadata and misleading sidecars.
- `server/src/agent/figure-reuse.ts` — Detects direct/copied source rasters and blocks missing/restrictive permission or credit.
- `server/src/agent/media-warnings.ts` — Adds figure-reuse warnings to existing create/edit checks.
- `server/src/agent/run-role.ts` — Exposes tool definition through the agent SDK boundary for the new job.
- `server/src/course/build.test.ts` — Checks media intent, legacy curricula and ignored fenced examples.
- `server/src/course/build.ts` — Derives media intent, current brief/video status and made/planned visuals from actual files.
- `server/src/inbox/plan-kickoffs.test.ts` — Checks the added media wait without single-slot deadlock or lost restart state.
- `server/src/inbox/plan-kickoffs.ts` — Persists media phase/restart state and queues drafts after source/media completion.
- `server/src/inbox/plans.ts` — Includes optional Visual/Video intents in proposal chapter views.
- `server/src/ingest/figures.test.ts` — Checks relevance/cap, raster bounds, legacy/symlink handling and Commons artist/license.
- `server/src/ingest/figures.ts` — Captures at most twelve relevant HTTPS rasters with per-file/page license and credit.
- `server/src/ingest/image-bytes.ts` — Shares the existing raster magic/dimension limits without importing Pi into ingest.
- `server/src/ingest/images.ts` — Carries optional source-image license and individual credit.
- `server/src/ingest/library.test.ts` — Updates capture metadata expectations using fake image fetches.
- `server/src/ingest/library.ts` — Publishes captured figure files and backward-compatible images.json v2.
- `server/src/ingest/refresh.ts` — Stages figure bytes/metadata under existing locks, rollback and atomic writes.
- `server/src/ingest/web.test.ts` — Checks restrictive tags, isolated figure licensing and named caption credit.
- `server/src/ingest/web.ts` — Detects explicit page/per-figure licenses, caption exceptions and LibreTexts tags.
- `server/src/jobs/draft-job.test.ts` — Verifies a clean report cannot waive missing visuals or restricted source-image reuse.
- `server/src/jobs/draft-job.ts` — Supplies the brief to draft/rewrite/revisions/checker and enforces media checked-status gates.
- `server/src/jobs/ingest-job.test.ts` — Uses fake image downloads and verifies images.json v2 through ingest.
- `server/src/jobs/ingest-job.ts` — Propagates cancellation into figure capture and retains Exa candidate images.
- `server/src/jobs/media-plan.test.ts` — Checks transcript moments, watch-only exclusion from evidence and explicit absence reasons.
- `server/src/jobs/media-plan.ts` — Refines figures/tables, evaluates videos through M13, ingests, and records real anchors or absence.
- `server/src/jobs/plan-job.test.ts` — Exercises generated media intent and legacy proposal compatibility.
- `server/src/jobs/plan-job.ts` — Requires media intent on new proposals and supports the internal existing-kind media phase.
- `server/src/jobs/source-preflight.ts` — Refines chapter media after evidence scouting and returns the brief to drafting.
- `server/src/routes/inbox.ts` — AI-gates and starts approved-plan media kickoff even without new source URLs.
- `server/src/tree/curriculum.ts` — Parses optional repeated Visual and single Video lines without changing legacy/fence behavior.
- `server/src/tree/media-brief.test.ts` — Checks persistence, confinement, silent omissions, actual files and missing/stale brief fallback.
- `server/src/tree/media-brief.ts` — Stores confined tracked briefs, validates actual visuals/omissions and preserves current requirements.
- `shared/src/api.ts` — Adds optional chapter/proposal media types to the existing API.
- `skills/.defaults-history.json` — Records updated default skill hashes.
- `skills/draft-chapter/SKILL.md` — Requires each planned visual or an honest muted omission and handles the chosen video.
- `skills/make-visual/SKILL.md` — Defines original redraws, permitted source copies, visible credit and media markers.
- `skills/media-authoring/SKILL.md` — Documents captured figures, reuse permission and realised media.
- `skills/plan-set/SKILL.md` — Requests per-chapter visual/video intent and quality rather than a set-wide video quota.
- `web/src/components/ChapterMediaStatus.tsx` — Shared compact made/planned and chosen/no-suitable-video status.
- `web/src/components/CoursePlan.test.tsx` — Checks visible visual intent/count and chosen video.
- `web/src/components/CoursePlan.tsx` — Shows chapter media in the existing Course plan rows.
- `web/src/pages/PlanPage.test.tsx` — Checks visible missing-video reason and planned visuals.
- `web/src/pages/PlanPage.tsx` — Shows the same media status in the existing Plan page.

## Five-line handoff log (for the orchestrator)

```text
2026-10-05 · M14 · Optional chapter Visual/Video intents and tracked briefs refined after kickoff and preflight; Course/Plan display actual media status.
Ingest/Refresh retain up to 12 local credited rasters; per-file/page permissions are conservative, and save_asset prefers captured bytes.
Draft/rewrite/revisions receive the brief; silent visual omissions and restricted/missing-credit source rasters block checked status.
Scoped validation: 480 passed/1 documented pre-existing book failure; focused follow-ups, package types/build, Biome and 8 browser checks pass.
Real trials: 20 briefs, 16 watch-only videos/4 honest absences; Hyderabad 2/2 visuals checked, polymers 1/2 plus explained omission/draft; Exa 35/$0.243, usage in report.
```

New gotchas: Commons metadata can be rate-limited; LibreTexts index/individual-page permissions differ. Video transcripts remain blocked on this host. Lexical evidence coverage can overstate foundation completeness; the independent checker remains mandatory.

## Final formatting and repository checks

Install completed first: `pnpm install --frozen-lockfile --prefer-offline` — passed (988 packages).

Exact final Biome command (48 files, passed with no fixes):

```sh
rtk proxy pnpm exec biome check docs/plans/m14-media-plan-evidence/hyderabad-history/visuals/hyderabad-timeline.json docs/plans/m14-media-plan-evidence/permitted-polymer-figure.json docs/plans/m14-media-plan-evidence/results.json docs/plans/m14-media-plan-evidence/screenshots/results.json server/scripts/m14-browser-api.ts server/scripts/m14-browser.mjs server/scripts/m14-figures-refresh.ts server/scripts/m14-media-trial.ts server/src/agent/builtins/save-asset.test.ts server/src/agent/builtins/save-asset.ts server/src/agent/figure-reuse.test.ts server/src/agent/figure-reuse.ts server/src/agent/media-warnings.ts server/src/agent/run-role.ts server/src/course/build.test.ts server/src/course/build.ts server/src/inbox/plan-kickoffs.test.ts server/src/inbox/plan-kickoffs.ts server/src/inbox/plans.ts server/src/ingest/figures.test.ts server/src/ingest/figures.ts server/src/ingest/image-bytes.ts server/src/ingest/images.ts server/src/ingest/library.test.ts server/src/ingest/library.ts server/src/ingest/refresh.ts server/src/ingest/web.test.ts server/src/ingest/web.ts server/src/jobs/draft-job.test.ts server/src/jobs/draft-job.ts server/src/jobs/ingest-job.test.ts server/src/jobs/ingest-job.ts server/src/jobs/media-plan.test.ts server/src/jobs/media-plan.ts server/src/jobs/plan-job.test.ts server/src/jobs/plan-job.ts server/src/jobs/source-preflight.ts server/src/routes/inbox.ts server/src/tree/curriculum.ts server/src/tree/media-brief.test.ts server/src/tree/media-brief.ts shared/src/api.ts skills/.defaults-history.json web/src/components/ChapterMediaStatus.tsx web/src/components/CoursePlan.test.tsx web/src/components/CoursePlan.tsx web/src/pages/PlanPage.test.tsx web/src/pages/PlanPage.tsx
```

`git diff --check` — passed. All changes remain uncommitted on `codex/m14`; no dependency changes, forbidden file edits or production writes.
