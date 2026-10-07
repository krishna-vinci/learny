Re-plan fix completed locally.

The polymers regression now drafts and checks both new chapters into unique filenames while preserving curriculum order 1/2. Both old notes remain byte-for-byte unchanged and appear as other notes. Existing chapters, active duplicate drafts, and invalid reserved paths fail before preflight, search, classifier, or model work.

**Changed files**

- [docs/STUDY_TREE.md](/path/to/studium-worktrees/replan-fix/docs/STUDY_TREE.md) — Documents chapter identity, filename allocation, and other-note ordering.
- [server/src/course/build.test.ts](/path/to/studium-worktrees/replan-fix/server/src/course/build.test.ts) — Updates genuine-match fixtures and covers two new planned chapters plus two other notes.
- [server/src/course/build.ts](/path/to/studium-worktrees/replan-fix/server/src/course/build.ts) — Uses identity matching and returns unmatched notes in otherNotes.
- [server/src/jobs/draft-job.test.ts](/path/to/studium-worktrees/replan-fix/server/src/jobs/draft-job.test.ts) — Covers the polymers draft/check flow, unchanged old files, cheap refusals, concurrent reservations, cleanup, and identity preservation through revision.
- [server/src/jobs/draft-job.ts](/path/to/studium-worktrees/replan-fix/server/src/jobs/draft-job.ts) — Reserves chapter identity and a unique path before research; rejects conflicts cheaply; persists curriculum order/id; releases reservations on failures.
- [server/src/jobs/source-preflight.test.ts](/path/to/studium-worktrees/replan-fix/server/src/jobs/source-preflight.test.ts) — Verifies the new chapter's scope is researched instead of an old chapter's scope.
- [server/src/jobs/source-preflight.ts](/path/to/studium-worktrees/replan-fix/server/src/jobs/source-preflight.ts) — Uses the shared identity matcher to select chapter scope.
- [server/src/routes/today.test.ts](/path/to/studium-worktrees/replan-fix/server/src/routes/today.test.ts) — Tests both APIs after a re-plan and gives the abbreviated SVD fixture an explicit chapter id.
- [server/src/routes/today.ts](/path/to/studium-worktrees/replan-fix/server/src/routes/today.ts) — Passes note metadata into Today snapshots.
- [server/src/today/build.test.ts](/path/to/studium-worktrees/replan-fix/server/src/today/build.test.ts) — Covers re-plans, renamed notes, and identity-based progress.
- [server/src/today/build.ts](/path/to/studium-worktrees/replan-fix/server/src/today/build.ts) — Uses note metadata for identity matching and derives missing chapters from actual notes rather than stale ticks.
- [server/src/tree/curriculum.test.ts](/path/to/studium-worktrees/replan-fix/server/src/tree/curriculum.test.ts) — Covers reused numbers, legacy matching, renamed titles, and authoritative chapter ids.
- [server/src/tree/curriculum.ts](/path/to/studium-worktrees/replan-fix/server/src/tree/curriculum.ts) — Matches explicit chapter ids, frontmatter titles, or legacy filename slugs; removes number-only matching.
- [server/src/tree/media-brief.test.ts](/path/to/studium-worktrees/replan-fix/server/src/tree/media-brief.test.ts) — Covers unrelated numbered notes and renamed notes with chapter ids.
- [server/src/tree/media-brief.ts](/path/to/studium-worktrees/replan-fix/server/src/tree/media-brief.ts) — Matches media briefs using note title/id metadata.
- [server/src/tree/read.test.ts](/path/to/studium-worktrees/replan-fix/server/src/tree/read.test.ts) — Verifies planned-first ordering with different filename numbers and renamed notes.
- [server/src/tree/read.ts](/path/to/studium-worktrees/replan-fix/server/src/tree/read.ts) — Exposes chapter metadata and orders planned notes first, then other notes by order/title.
- [shared/src/api.ts](/path/to/studium-worktrees/replan-fix/shared/src/api.ts) — Adds optional NoteSummary.chapter and CourseView.otherNotes fields.
- [shared/src/frontmatter.test.ts](/path/to/studium-worktrees/replan-fix/shared/src/frontmatter.test.ts) — Verifies chapter metadata, legacy frontmatter, and unknown fields.
- [shared/src/schemas.ts](/path/to/studium-worktrees/replan-fix/shared/src/schemas.ts) — Adds an optional chapter field to tolerant note frontmatter.
- [web/src/components/CoursePlan.test.tsx](/path/to/studium-worktrees/replan-fix/web/src/components/CoursePlan.test.tsx) — Verifies old notes remain linked while new chapters stay draftable.
- [web/src/components/CoursePlan.tsx](/path/to/studium-worktrees/replan-fix/web/src/components/CoursePlan.tsx) — Shows linked other notes below the course plan.
- [web/src/pages/PlanPage.test.tsx](/path/to/studium-worktrees/replan-fix/web/src/pages/PlanPage.test.tsx) — Verifies other-note links for populated and empty plans.
- [web/src/pages/PlanPage.tsx](/path/to/studium-worktrees/replan-fix/web/src/pages/PlanPage.tsx) — Shows the shared other-notes list, including when the plan body is empty.

**Tests run**

Final verification:
- `pnpm --filter @studium/server exec vitest run src/tree/ src/jobs/draft-job.test.ts src/course/ src/today/ src/jobs/source-preflight.test.ts src/routes/today.test.ts` — 162 passed, 0 failed across 16 files. Includes media-brief tests through src/tree/.
- `pnpm --filter @studium/server exec vitest run src/routes/sets.test.ts -t 'serves a read-only course'` — 1 passed, 14 intentionally skipped, 0 failed.
- `pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx src/pages/PlanPage.test.tsx` — 15 passed, 0 failed.
- `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` — 8 passed, 0 failed.
- `pnpm --filter @studium/server exec tsc --noEmit` — passed, 0 errors.
- `pnpm --filter @studium/web exec tsc --noEmit` — passed, 0 errors.
- `pnpm --filter @studium/shared exec tsc --noEmit` — passed, 0 errors.
- `rtk proxy pnpm exec biome check 'docs/STUDY_TREE.md' 'server/src/course/build.test.ts' 'server/src/course/build.ts' 'server/src/jobs/draft-job.test.ts' 'server/src/jobs/draft-job.ts' 'server/src/jobs/source-preflight.test.ts' 'server/src/jobs/source-preflight.ts' 'server/src/routes/today.test.ts' 'server/src/routes/today.ts' 'server/src/today/build.test.ts' 'server/src/today/build.ts' 'server/src/tree/curriculum.ts' 'server/src/tree/media-brief.test.ts' 'server/src/tree/media-brief.ts' 'server/src/tree/read.test.ts' 'server/src/tree/read.ts' 'shared/src/api.ts' 'shared/src/frontmatter.test.ts' 'shared/src/schemas.ts' 'web/src/components/CoursePlan.test.tsx' 'web/src/components/CoursePlan.tsx' 'web/src/pages/PlanPage.test.tsx' 'web/src/pages/PlanPage.tsx' 'server/src/tree/curriculum.test.ts'` — 23 TypeScript files checked, 0 issues; Markdown is not checked by Biome.
- `git diff --check` — passed.

Setup: `pnpm install --frozen-lockfile --prefer-offline` completed before implementation/testing.

Earlier runs exposed old number-only fixtures and two test expectations; these were corrected and the final relevant scope passed. No unrelated failures remain. No full suite or paid/provider/network smoke tests ran.

**Not done / open questions / deviations**

No open implementation items. Added focused Today/course API and shared-schema checks plus data-contract documentation. CourseView.otherNotes is optional for compatibility; the server always returns the array. Today.notesCount remains the count of all notes, while planned progress uses matching chapter identities.

The live study tree was not changed or migrated. No browser screenshots, commits, pushes, branch changes, deployments, or process stops. No changes to AGENT_MEMORY.md, .env files, .claude/, or data/.

**Five-line log entry**

```text
2026-10-06 · replan-fix · Local implementation; no commit/push/deployment.
Tree matcher/read/media and draft/preflight/course/Today now use chapter identity.
New drafts store chapter slug + curriculum order; old notes stay unchanged and visible.
CoursePlan/PlanPage list other notes; 186 scoped tests, 3 typechecks, and Biome pass.
Gotcha: preserve chapter when renaming note titles; ids use existing 40-character slugs. Open: none.
```

