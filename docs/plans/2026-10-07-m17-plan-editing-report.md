# M17 — Plan editing implementation and progress

Scope: owner's M17 brief, implemented inline in this worktree. No workers, repository commits, pushes, merges, `.env` changes, or writes to live data.

## Plan
- [x] 1. Lossless curriculum serialiser and validated update/insert/delete/move operations; preserve unknown lines and checkbox ticks.
- [x] 2. Locked curriculum route and linked note/media mutations, conflict detection, user commits and undo; validated PLAN.md saves.
- [x] 3. Shared phone chapter sheet / desktop dialog, Plan and Course actions, CodeMirror plan editing.
- [x] 4. Small-change outliner mode, editable Inbox proposals and chapter change summary.
- [x] 5. Contract/UI/D39 docs and plan-set skill history.
- [x] 6. Scoped tests, package typechecks, web build and changed-file Biome.
- [x] 7. Real-click browser trial on temp data, phone/desktop screenshots, cleanup and final report.

## Discovery
Read AGENTS.md, owner memory, Principles, UI, Teaching, study-tree/spec documents and decisions. Existing chapter identity is a title slug (explicit note `chapter:` wins). Media names include number and title slug; course read checks brief chapter identity, scope and visual/video intent. Existing file PUT only accepts notes. Proposal parsing currently restricts plans to 6–14 chapters; edits must permit smaller/larger existing plans without forcing re-planning. Existing Dialog is a body portal, bottom aligned on phones.

Design: retain the parsed chapter's source line as identity inside each operation, renumber and remap prerequisites, and serialise against the original document to preserve unrecognised content. Coordinate linked file changes with the existing set mutation gate and individual file locks; rollback on failed writes/commit. Use the same operation contract for proposal edits but mutate only its curriculum fence. Existing user commit/revert provides Undo.

## Step 1 complete
Implemented source-aware serialisation and all four operations. Real polymers fixture copied read-only from `/path/to/studium/data/users/<username>/polymers/curriculum.md`. Unknown content, fences, Image lines, ticks and CRLF survive round-trips; edited fields remain parseable. References follow chapter identity and invalid prerequisite orders are rejected.

Validation: `pnpm --filter @studium/server exec vitest run src/tree/curriculum.test.ts src/tree/curriculum-edit.test.ts` — 2 files, 11 tests passed. Includes linked note/media updates, stale media, deletion retaining a note, undo and injected-write rollback.

## Step 2 implemented
Added GET/PATCH curriculum family with previous-text 409 detection and validated PLAN.md file PUT. Set-wide gate and per-file locks coordinate linked note frontmatter and media file changes with one user commit. Existing git revert powers Undo. Linked note paths and bodies remain intact. Active tasks block direct chapter edits.

## Steps 3–4 implemented
Shared chapter sheet/dialog in Plan, Course row menus and Inbox proposals. Existing CodeMirror note save/conflict/discard UI extracted for PLAN.md reuse. Small-change jobs send a distinct outliner mode and leave legacy media unchanged. Inbox shows added/removed/renamed/changed/unchanged with field details and edits only the proposal curriculum fence. Route and web validation underway.

Trial constraint identified: polymers chapter 05 currently depends on 04 (`Prerequisites: 03, 04`). Moving 05 above 04 must return a prerequisite validation error. The trial will verify refusal and stop that incompatible move step; it will not silently remove the prerequisite.

Route validation: `pnpm --filter @studium/server exec vitest run src/routes/sets.test.ts src/routes/inbox.test.ts src/jobs/plan-job.test.ts src/inbox/plans.test.ts` — 4 files, 45 passed.
Initial web scope: 62 passed / 1 failed (summary inferred a rename without evidence). Fixed the cause by retaining ambiguous pairs as removed/added. Initial server typecheck found only new-test annotations; corrected them. Web/shared typechecks passed on the first run.

## Steps 2–4 verified
Proposal edits retain origin metadata in a plain Markdown comment, allowing title+scope changes to preserve live note/media links on approval. Approval now uses the coordinated linked-file write/rollback path. The note-side media check omitted video intent; added that check and a regression test. Curriculum operations support adding to an empty course.

`pnpm --filter @studium/server exec vitest run src/routes/inbox.test.ts src/tree/media-brief.test.ts src/tree/curriculum-edit.test.ts src/inbox/plans.test.ts` — 4 files, 37 passed. Includes proposal edit conflict, stale approval, and rename approval retaining the note.

## Step 5 complete
Documented curriculum write and identity rules, mobile editing and Inbox UX; added D39; registered the plan-set skill hash via `node scripts/skill-history.mjs`. No new dependencies. Initial Biome format pass completed; cleaning warnings before final checks.

Browser harness prepared: real application API, filesystem/git mutations and plan job, with auth stub and deterministic faux provider; no external services or paid requests. Chrome uses CDP pointer/keyboard events, not evaluated element clicks. All trial writes go to `/tmp/studium-m17-*`; live data is only read for the copy.

## Step 6 complete
Final scoped server run: `pnpm --filter @studium/server exec vitest run src/tree/ src/course/ src/inbox/ src/routes/sets.test.ts src/routes/inbox.test.ts src/jobs/plan-job.test.ts src/jobs/routes.test.ts` — 21 files, **223 passed / 0 failed**. No full-suite run.

Final scoped web run: `pnpm --filter @studium/web exec vitest run src/components/ChapterEditSheet.test.tsx src/components/PlanChangeSummary.test.tsx src/pages/PlanPage.test.tsx src/pages/InboxPlanReview.test.tsx src/components/CoursePlan.test.tsx src/components/Reader/Reader.test.tsx src/components/NoteEditor/CodeMirrorNoteEditor.test.tsx` — 7 files, **67 passed / 0 failed**. Covers shared forms, all summary categories, photo-slot summary, proposal-only edits and PLAN editor entry.

Types: `pnpm --filter @studium/server exec tsc --noEmit`, `pnpm --filter @studium/web exec tsc --noEmit`, `pnpm --filter @studium/shared exec tsc --noEmit` — all passed. `pnpm --filter @studium/web build` passed (existing large-chunk warnings). `rtk proxy pnpm exec biome check --write <changed TS/TSX/JSON/MJS files>` passed, no warnings after import cleanup. Final nonwriting Biome and diff check will follow the browser trial.

## Step 7 in progress
Temp workspace: `/tmp/studium-m17-tree-4s5mylyk`. Config points only to `faux/echo`; MCP services disabled in the copy. Browser harness uses application routes/job implementation with a faux provider and an auth stub. Startup originally exceeded the harness's 10-second wait; extended to 60 seconds. The first trial opened the sheet and saved initial phone screenshots, then encountered an invalid CDP click rectangle; added diagnostic exceptions and service-worker activation settling before real input. Trial runs stop only their spawned Chrome/API/static-server processes.

## Step 7 complete — final browser acceptance

Command: `node server/scripts/m17-plan-editing-browser.mjs /tmp/studium-m17-tree-1m2h1z76` — **passed**, exit 0, no browser exceptions. `STUDIUM_FAUX=1` is set on the child API process. The fresh copy was made from `/path/to/studium/data/users/<username>`; `.env*` files were excluded. The API binds its own random loopback port; the static proxy and Chrome also use isolated ports/profile. All spawned servers and Chrome stopped in the harness's `finally`; process check found none remaining. Auth is stubbed in this verification harness; mutation routes, locks, git history, JobRunner, Outliner wrapper, proposal validation and agent file tools are real. No paid calls or external services.

Real-pointer/keyboard checks on polymers:
- Chapter 03 renamed to Carbon structures, groups and reactions; its original note path remains linked.
- Added `step-through — Bond formation; step through one bond at a time` to chapter 01.
- Move 05 above 04 rejected, preserving its prerequisite and order.
- Deleted chapter 03; its note appeared as an other note; clicked Undo and restored its chapter number/link.
- Edited PLAN.md with CodeMirror and saved a new paragraph.
- Opened Edit chapter from the Course row menu; set rows still show chapter 3 and the original note URL.
- Used Change with agent to request a chapter-03 photo slot. Real plan job with faux model wrote a normal Inbox proposal.
- Edited proposal chapter 03's title and scope; live curriculum stayed unchanged. Summary showed renamed + scope/images changes against the live curriculum.
- Screenshots inspected at 390 × 844 and 1440 × 1000; no horizontal overflow or browser runtime errors.

Harness issues resolved: service-worker first activation reload, readiness checks against a temporarily missing document body, an error toast intercepting Save (the trial now clicks its Dismiss control first), and accidental attempt to serialise a DOM node through CDP. Inbox readiness checks now use its To review heading (its Plan badge renders uppercase in innerText). These were verification harness fixes, not product save failures.

## Final verification

- `pnpm --filter @studium/server exec vitest run src/tree/ src/course/ src/inbox/ src/routes/sets.test.ts src/routes/inbox.test.ts src/jobs/plan-job.test.ts src/jobs/routes.test.ts` — **21 files, 224 passed, 0 failed**. Final run includes the real JobRunner approval gate regression.
- `pnpm --filter @studium/web exec vitest run src/components/ChapterEditSheet.test.tsx src/components/PlanChangeSummary.test.tsx src/pages/PlanPage.test.tsx src/pages/InboxPlanReview.test.tsx src/components/CoursePlan.test.tsx src/components/Reader/Reader.test.tsx src/components/NoteEditor/CodeMirrorNoteEditor.test.tsx` — **7 files, 67 passed, 0 failed**.
- `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` — **1 file, 8 passed, 0 failed**.
- `pnpm --filter @studium/server exec tsc --noEmit` — passed.
- `pnpm --filter @studium/web exec tsc --noEmit` — passed.
- `pnpm --filter @studium/shared exec tsc --noEmit` — passed.
- `pnpm --filter @studium/web build` — passed; pre-existing warnings about large chunks only.
- `git diff --check` — passed.
- `node scripts/skill-history.mjs` — plan-set hash registered; all other skill hashes unchanged.
- `pnpm install --frozen-lockfile --prefer-offline` — dependencies installed once for this worktree; lockfile unchanged.

Acceptance correction: proposal approval now queues draft/media/source work **after** the coordinated set gate releases; the real JobRunner refuses enqueue while that gate is held. The regression test exercises the actual enqueue path rather than the existing route tests' mock. Direct chapter editing distinguishes a file conflict from a busy-set 409, and refuses an edit of a chapter that disappeared rather than inserting an unintended replacement.

## Deviations / not done / open questions

1. **Requested polymers move is incompatible with prerequisite validation.** `server/src/tree/fixtures/polymers-curriculum.md:28` (copied from the live file) says chapter 05 requires `03, 04`. Moving it above 04 creates a forward reference. The trial verified rejection and stopped that step; it did not weaken the prerequisite. Allowed moves and prerequisite rewrites are covered by tests.
2. Verification used Chromium emulating phone width, with auth stub and faux Outliner. Production authentication, real-provider teaching quality and iPhone/WebKit were outside this isolated trial.
3. Ambiguous agent chapter identity is shown as removed/added. Learner proposal edits carry recorded origins, including when both title and scope change.
4. No repository commit, push, merge, deployment, memory edit, `.env*` change or live-data write. No sub-workers or new dependencies.

## Screenshot paths

- `docs/plans/m17-plan-editing-evidence/1440-chapter-dialog.png` — 1440 × 1000.
- `docs/plans/m17-plan-editing-evidence/1440-inbox-change-summary.png` — 1440 × 1000.
- `docs/plans/m17-plan-editing-evidence/1440-plan-page.png` — 1440 × 1000.
- `docs/plans/m17-plan-editing-evidence/390-chapter-sheet.png` — 390 × 844.
- `docs/plans/m17-plan-editing-evidence/390-inbox-change-summary.png` — 390 × 844.
- `docs/plans/m17-plan-editing-evidence/390-plan-page.png` — 390 × 844.
- `docs/plans/m17-plan-editing-evidence/results.json` — browser assertions and zero runtime errors.

Final nonwriting Biome command (exact):

```sh
rtk proxy pnpm exec biome check docs/plans/m17-plan-editing-evidence/results.json server/scripts/m17-browser-api.ts server/scripts/m17-plan-editing-browser.mjs server/src/inbox/plans.ts server/src/jobs/plan-job.test.ts server/src/jobs/plan-job.ts server/src/jobs/routes.ts server/src/routes/inbox.test.ts server/src/routes/inbox.ts server/src/routes/sets.test.ts server/src/routes/sets.ts server/src/tree/authoring.ts server/src/tree/curriculum-edit.test.ts server/src/tree/curriculum-edit.ts server/src/tree/curriculum.test.ts server/src/tree/curriculum.ts server/src/tree/media-brief.test.ts server/src/tree/media-brief.ts shared/src/api.ts skills/.defaults-history.json web/src/api/client.ts web/src/api/queries.ts web/src/components/ChapterEditSheet.test.tsx web/src/components/ChapterEditSheet.tsx web/src/components/CoursePlan.test.tsx web/src/components/CoursePlan.tsx web/src/components/CurriculumEditing.tsx web/src/components/NoteEditor/NoteEditor.tsx web/src/components/PlanChangeSummary.test.tsx web/src/components/PlanChangeSummary.tsx web/src/components/PlanSetSheet.tsx web/src/components/Reader/Reader.tsx web/src/pages/InboxPlanReview.test.tsx web/src/pages/InboxPlanReview.tsx web/src/pages/PlanPage.test.tsx web/src/pages/PlanPage.tsx
```

Result: **passed**, exit 0; Checked 36 files in 190ms. No fixes applied.

## Changed files (one line each)

- `docs/STUDY_TREE.md` — Curriculum write, prerequisite, identity, media, conflict and proposal-origin contracts.
- `docs/UI.md` — Phone/desktop Plan editing and Inbox review flows; mobile editing supported.
- `docs/decisions/LOG.md` — D39 records direct editing and minimal agent changes.
- `docs/plans/2026-10-07-m17-plan-editing-report.md` — Implementation steps, validation, screenshots, deviations and memory entry.
- `docs/plans/m17-plan-editing-evidence/1440-chapter-dialog.png` — Inspected desktop screenshot of 1440-chapter-dialog.
- `docs/plans/m17-plan-editing-evidence/1440-inbox-change-summary.png` — Inspected desktop screenshot of 1440-inbox-change-summary.
- `docs/plans/m17-plan-editing-evidence/1440-plan-page.png` — Inspected desktop screenshot of 1440-plan-page.
- `docs/plans/m17-plan-editing-evidence/390-chapter-sheet.png` — Inspected phone screenshot of 390-chapter-sheet.
- `docs/plans/m17-plan-editing-evidence/390-inbox-change-summary.png` — Inspected phone screenshot of 390-inbox-change-summary.
- `docs/plans/m17-plan-editing-evidence/390-plan-page.png` — Inspected phone screenshot of 390-plan-page.
- `docs/plans/m17-plan-editing-evidence/results.json` — Browser acceptance results and zero runtime errors.
- `server/scripts/m17-browser-api.ts` — Temp-only application API with production jobs/routes and faux Outliner.
- `server/scripts/m17-plan-editing-browser.mjs` — Reproducible CDP real-pointer/keyboard trial, screenshots and child-process cleanup.
- `server/src/inbox/plans.ts` — Editable chapter counts, fence replacement and recorded chapter-origin identity.
- `server/src/jobs/plan-job.test.ts` — Faux coverage for normal and small-change job modes; rejects invalid mode.
- `server/src/jobs/plan-job.ts` — Small-change input and task instructions; unchanged legacy media stays intact.
- `server/src/jobs/routes.ts` — Small changes refuse missing sets instead of creating a new course.
- `server/src/routes/inbox.test.ts` — Proposal edit/approval conflicts, linked rename approval and real enqueue after gate release.
- `server/src/routes/inbox.ts` — Current-versus-proposed preview, proposal chapter PATCH, atomic linked approval and conflict checks.
- `server/src/routes/sets.test.ts` — Curriculum route operations, empty plan insertion, 409s and validated PLAN saves.
- `server/src/routes/sets.ts` — GET/PATCH curriculum route and PLAN.md support in existing file PUT.
- `server/src/tree/authoring.ts` — Complete, schema-valid PLAN frontmatter saves using previous-text conflicts.
- `server/src/tree/curriculum-edit.test.ts` — Linked note/media carry-over, stale briefs, insert/move/delete, undo, symlinks and rollback.
- `server/src/tree/curriculum-edit.ts` — Validated operations, coordinated locks, note metadata/media writes and one user commit.
- `server/src/tree/curriculum.test.ts` — Real-data round-trip and all operations, prerequisite validation and unknown-content preservation.
- `server/src/tree/curriculum.ts` — Source-aware lossless serialiser, prerequisite renumbering and operation/view helpers.
- `server/src/tree/fixtures/polymers-curriculum.md` — Read-only copy of the real polymers curriculum for round-trip tests.
- `server/src/tree/media-brief.test.ts` — Video-only stale brief regression.
- `server/src/tree/media-brief.ts` — Note-side brief validity now compares Video intent and supports video-only needs.
- `shared/src/api.ts` — Typed chapter edit operations/views and proposal raw/current/origin/image fields.
- `skills/.defaults-history.json` — Registers the new plan-set skill hash.
- `skills/plan-set/SKILL.md` — Smallest-change mode preserving unrelated chapters and existing course size.
- `web/src/api/client.ts` — Curriculum/proposal editing calls, small-change mode and approval previous-text support.
- `web/src/api/queries.ts` — PLAN saves refresh set header facts and course state.
- `web/src/components/ChapterEditSheet.test.tsx` — Field/visual editing, server errors, unknown forms and conflict reload coverage.
- `web/src/components/ChapterEditSheet.tsx` — Shared phone sheet/desktop dialog for title, scope, prerequisites and media.
- `web/src/components/CoursePlan.test.tsx` — Prerequisite error guidance now directs learners to chapter editing.
- `web/src/components/CoursePlan.tsx` — Chapter operation menus for every row while retaining note rewrite actions.
- `web/src/components/CurriculumEditing.tsx` — Shared edit/insert/move/delete controller, conflict banner, confirmation and Undo.
- `web/src/components/NoteEditor/NoteEditor.tsx` — Extracted existing CodeMirror save/conflict/discard flow; body portal and visible save errors.
- `web/src/components/PlanChangeSummary.test.tsx` — All change categories, moves, recorded origins and photo-slot changes.
- `web/src/components/PlanChangeSummary.tsx` — Per-chapter summary and before/after order, scope, prerequisite, visual/image/video details.
- `web/src/components/PlanSetSheet.tsx` — Small-request form and normal planning form share the existing overlay.
- `web/src/components/Reader/Reader.tsx` — Uses the extracted shared note editor.
- `web/src/pages/InboxPlanReview.test.tsx` — Proposal-only chapter edit with the shared sheet.
- `web/src/pages/InboxPlanReview.tsx` — Editable proposed chapters, change summary and stale-approval reload.
- `web/src/pages/PlanPage.test.tsx` — PLAN editor entry coverage and QueryClient setup for new chapter actions.
- `web/src/pages/PlanPage.tsx` — Plan text editing, chapter actions/addition and small-change agent entry.

## AGENT_MEMORY.md entry (five lines; do not edit memory directly)

```text
2026-10-07 · M17 · Direct plan editing implemented in m17-plan-editing; uncommitted.
Curriculum edits preserve ticks/unknown text, remap prerequisites, retain note links and carry media; user commits provide Undo.
Shared ChapterEditSheet and NoteEditor serve Plan/Course/Inbox; proposal origin comments preserve links through edited approval.
Verified 224 server + 67 web + 8 shared tests, all types/build/Biome, and six 390/1440 screenshots; see 2026-10-07-m17-plan-editing-report.md.
Open: polymers 05 cannot move before prerequisite 04; real-provider/auth and iPhone/WebKit excluded from faux Chromium trial.
```
