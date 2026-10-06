# M16 chapters and media implementation plan

The owner's M16 request is the approved specification. Worktree baseline:
`f7363752678ce1fc9c8136ef50758ce1802f3389`, branch `m16-chapters-media`, initially clean.
No commits, pushes, merges, new dependencies, `.env*` changes, or live data writes.

## Contracts

- `NoteSummary.number?: number` is derived from `curriculum.md` using `chapterExists`.
  Filename prefixes and note order never establish chapter identity or numbering.
  All named title surfaces display it; unmatched notes have no chapter number.
- Course media accepts current original-plan or draft-time-fallback brief intents.
  Missing planned intents remain explicitly unmade; each visual carries `interactive`.
- `media.allowUnknownLicense` defaults true and overrides licence exclusions for
  unmodified credited images; false preserves the existing NC setting and policy.
  Missing visible attribution/source links remain blockers. Preserve byte hashes
  for images that require unmodified reuse; do not weaken SSRF, MIME, paths or sandbox.
- Capture every useful content figure; retain decorative/tiny-image filters.
  Raise figure/save_asset payload size to 25 MB. Keep the 5 KB brief prompt budget,
  selecting candidates by chapter scope, captions, sections and visual intents.
  Inventory all source/media limits before changing them and report dispositions.

## Dependency-ordered bundle (one Flash writer)

1. Reconstruct the annotated partial edits after failed `git apply`, reproduce and
   explain the invalid-brief/realised-visual regression, complete numbering surfaces.
2. Implement the licence contract across config, capture/search/save, checker,
   briefs/skills, reader and book; add D38 and register changed skills.
3. Inventory limits with original file:line/value/reason, remove content-only caps,
   raise binary sizes, rank bounded prompt selection; add focused regression tests.
4. Run scoped course/tree/ingest/jobs plus touched tests, all three typechecks,
   web build and `rtk proxy` Biome; trial a temp copy at an owned port, capture
   390 px set/reader/plan evidence and deterministic Carbon structures refinement.
   Stop only task-owned servers. Record exact commands/counts in the report.

## Acceptance and ownership

Flash owns relevant `server/`, `shared/`, `web/`, named `skills/`, required docs,
and uniquely named M16 trial scripts/evidence/report. Root owns this plan and final
review. Preserve all concurrent edits. Worker may not delegate or load orchestration.
If a step does not fit real code, stop that step and report file:line/evidence.

Review specification coverage and quality/security together against baseline.
Inspect tests and screenshots without routinely repeating the worker's full checks.
Use one consolidated correction request if needed. Final report includes one line
per changed file, exact test counts, limits table, screenshot paths, deviations,
and a five-line proposed memory log; never edit `AGENT_MEMORY.md`.

## Initial deviations/routing evidence

- Supplied `/home/krishna/learny/.worktrees/m16-partial.patch:13` is annotated text,
  not unified Git patch syntax. `git apply` returned `No valid patches in input`.
  Reconstruct its intended edits; do not modify the supplied file.
- Native `astra_flash_builder` is available and static doctor reports the pinned
  Command Code `commandcode/deepseek-v4.1-flash` route ready. Static global config
  observes root `gpt-6.1-sol`; it cannot resolve active UI/session overrides.
  No root/route configuration changes or paid setup probes are authorized.
  Runtime routing must be reported from host metadata if available, else unverified.

## Recovery checkpoint

The first native worker turn ended with a Command Code HTTP 400 rejection.
It left 32 tracked files changed plus `web/src/lib/chapter-label.ts`, covering
substantial A/B behavior. No final validation, limit inventory, docs/skills policy,
or trial artifacts were available at recovery. The errored child was stopped,
then resumed via `followup_task` on the same pinned role/route to complete the
remaining contract. No files were reverted and no alternate worker was used.
Worker thread: `/root/m16_implementation`; final acceptance is pending.

## Final acceptance

One consolidated Flash correction cycle addressed attribution, byte preservation,
content capture, production-equivalent refinement, book links and screenshot readiness.
Root integration then reproduced and fixed redundant-figure selection crowding out
functional-group evidence, and source links containing parentheses. The final temp
refinement keeps two figures and two tables in 4,962 JSON bytes, including functional
groups, with no thermal-transition or DNA figures. Root integration passed 287
tree/jobs/course tests, the focused book-link assertion, server typechecking and Biome.
Worker scoped evidence covers the remaining ingest/agent/Today, shared and web paths,
all three package typechecks and the web build. The final server scope has 493 distinct
passing tests. Screenshots and exact commands are in `docs/plans/m16-evidence/`.
The actual diff and corrected screenshots were reviewed; accepted with the process
deviations and pre-existing failures explicitly recorded in the report. No commit,
push, merge, deployment, `.env*` change or live-data write. The child is stopped.
