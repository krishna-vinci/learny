# M8 implementation report — 2026-10-01

Implemented Parts 1–4 and V1–V6 on `codex/m8`. Changes are local and uncommitted.
Read the full plan, shared memory, required project contracts and all five cited live
Hyderabad chapters. The live chapters were read only. No branches, PRs, pushes,
commits, orchestration skills or sub-agents were created. No .env, .claude or live
data edits. All filesystem tests and browser data use temp copies.

## Changed files per part

### Part 1 — Teaching philosophy, subjects and skills

- [AGENTS.md](/home/krishna/learny-worktrees/m8/AGENTS.md) — Adds teaching commitments to the required read list.
- [docs/PRINCIPLES.md](/home/krishna/learny-worktrees/m8/docs/PRINCIPLES.md) — Links the teaching philosophy.
- [docs/decisions/LOG.md](/home/krishna/learny-worktrees/m8/docs/decisions/LOG.md) — Records locked D30, covering V1–V6.
- [shared/src/frontmatter.test.ts](/home/krishna/learny-worktrees/m8/shared/src/frontmatter.test.ts) — Tests all subjects and legacy/unknown plans.
- [shared/src/schemas.ts](/home/krishna/learny-worktrees/m8/shared/src/schemas.ts) — Adds optional tolerant PlanSubject enum; unknown values become general.
- [skills/.defaults-history.json](/home/krishna/learny-worktrees/m8/skills/.defaults-history.json) — Registers new/changed default skills and references, including Part 2 checker changes.
- [skills/draft-chapter/SKILL.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/SKILL.md) — Replaces the math-only template with V2, subject-guide loading and rewrite guidance; retains grounding/media rules.
- [skills/note-authoring/SKILL.md](/home/krishna/learny-worktrees/m8/skills/note-authoring/SKILL.md) — Adds warm teacher voice, never-list and human footnote examples.
- [skills/plan-set/SKILL.md](/home/krishna/learny-worktrees/m8/skills/plan-set/SKILL.md) — Chooses subject and learner-facing chapter scopes in plan proposals.
- [docs/TEACHING.md](/home/krishna/learny-worktrees/m8/docs/TEACHING.md) — Defines V1/V2/V4, maps all 20 rules and the additional learning principles (106 lines).
- [skills/draft-chapter/references/subject-finance.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-finance.md) — Adds the finance guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-general.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-general.md) — Adds the general guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-history.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-history.md) — Adds the history guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-language.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-language.md) — Adds the language guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-math.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-math.md) — Adds the math guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-practical.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-practical.md) — Adds the practical guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-science.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-science.md) — Adds the science guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/draft-chapter/references/subject-technology.md](/home/krishna/learny-worktrees/m8/skills/draft-chapter/references/subject-technology.md) — Adds the technology guide (28 lines) with shape, blocks, examples, pitfalls and a tiny teacher-voice excerpt.
- [skills/note-authoring/references/teaching.md](/home/krishna/learny-worktrees/m8/skills/note-authoring/references/teaching.md) — Ships the teaching reference into study trees with the default skill.

### Part 2 — Teaching-quality warnings and checker

- [server/src/agent/tools.test.ts](/home/krishna/learny-worktrees/m8/server/src/agent/tools.test.ts) — Verifies warned note writes still succeed.
- [server/src/agent/tools.ts](/home/krishna/learny-worktrees/m8/server/src/agent/tools.ts) — Returns teaching warnings alongside existing media warnings on creates/edits.
- [skills/fact-check/SKILL.md](/home/krishna/learny-worktrees/m8/skills/fact-check/SKILL.md) — Adds teaching-quality report blockers and non-blocking voice notes.
- [server/src/agent/note-lint.test.ts](/home/krishna/learny-worktrees/m8/server/src/agent/note-lint.test.ts) — Tests human footnotes, all warning patterns and scope exclusions.
- [server/src/agent/note-lint.ts](/home/krishna/learny-worktrees/m8/server/src/agent/note-lint.ts) — Implements the three cheap teaching-warning patterns, scoped to chapter notes.

### Part 3 — Rewrite pipeline and reader actions

- [server/src/jobs/draft-job.test.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/draft-job.test.ts) — Tests rewrite pinning/preservation/checking/missing notes, lint rejection, and Part 4 numbering/tick repair before checker failure.
- [server/src/jobs/draft-job.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/draft-job.ts) — Shares draft/check/revision pipeline with pinned rewrites; preserves metadata/citations/figures, blocks remaining lint; Part 4 reserves planned numbers and ticks/repairs at draft commit.
- [server/src/jobs/log.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/log.ts) — Parses persisted rewrite job history.
- [server/src/jobs/routes.test.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/routes.test.ts) — Tests rewrite validation, missing notes, AI denial and Part 4 tutor-proposal acceptance.
- [server/src/jobs/routes.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/routes.ts) — Accepts validated direct/proposed rewrite jobs; missing notes return 404, AI gate remains at enqueue.
- [server/src/workspaces/manager.ts](/home/krishna/learny-worktrees/m8/server/src/workspaces/manager.ts) — Registers the rewrite handler in each workspace.
- [shared/src/api.ts](/home/krishna/learny-worktrees/m8/shared/src/api.ts) — Adds rewrite-chapter JobKind and Part 4 CourseView/CourseChapter response types.
- [web/src/api/client.ts](/home/krishna/learny-worktrees/m8/web/src/api/client.ts) — Adds rewrite request union and Part 4 course GET client.
- [web/src/api/queries.ts](/home/krishna/learny-worktrees/m8/web/src/api/queries.ts) — Refreshes note/inbox data after rewrites; Part 4 course query and file/commit/status invalidation.
- [web/src/components/Activity/ActivityPanelContent.tsx](/home/krishna/learny-worktrees/m8/web/src/components/Activity/ActivityPanelContent.tsx) — Adds rewrite icon and user-facing label.
- [web/src/components/Activity/JobToasts.tsx](/home/krishna/learny-worktrees/m8/web/src/components/Activity/JobToasts.tsx) — Links completed rewrites to their existing notes.
- [web/src/components/Reader/Reader.tsx](/home/krishna/learny-worktrees/m8/web/src/components/Reader/Reader.tsx) — Adds the rewrite overflow action using Base UI onClick and the shared dialog.
- [web/src/pages/JobsPage.tsx](/home/krishna/learny-worktrees/m8/web/src/pages/JobsPage.tsx) — Labels queued/recent rewrites as Rewriting chapter.
- [web/src/components/RewriteChapterDialog.test.tsx](/home/krishna/learny-worktrees/m8/web/src/components/RewriteChapterDialog.test.tsx) — Tests consent copy and exact rewrite request after confirmation.
- [web/src/components/RewriteChapterDialog.tsx](/home/krishna/learny-worktrees/m8/web/src/components/RewriteChapterDialog.tsx) — Explains facts/sources and History undo, then enqueues the exact note rewrite.

### Part 4 — Reusable course plan and tutor

- [server/src/agent/chat-service.ts](/home/krishna/learny-worktrees/m8/server/src/agent/chat-service.ts) — Supplies current active jobs whenever tutor context is rebuilt.
- [server/src/agent/prompt.ts](/home/krishna/learny-worktrees/m8/server/src/agent/prompt.ts) — Adds a ≤30-line tutor course summary plus draft/range/rewrite proposal instructions.
- [server/src/agent/roles.test.ts](/home/krishna/learny-worktrees/m8/server/src/agent/roles.test.ts) — Verifies bounded summary, states and both job instructions.
- [server/src/agent/roles.ts](/home/krishna/learny-worktrees/m8/server/src/agent/roles.ts) — Passes active chapter state through tutor prompt context; existing start_job allowlist is retained.
- [server/src/app.ts](/home/krishna/learny-worktrees/m8/server/src/app.ts) — Passes the workspace job runner into set routes.
- [server/src/jobs/proposals.test.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/proposals.test.ts) — Tests rewrite proposal path, estimate/persistence and invalid-path rejection with faux models.
- [server/src/jobs/proposals.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/proposals.ts) — Adds estimated, persisted one-shot rewrite proposals to start_job and result handling.
- [server/src/jobs/runner.ts](/home/krishna/learny-worktrees/m8/server/src/jobs/runner.ts) — Provides an uncapped active chapter projection without exposing raw job inputs.
- [server/src/routes/sets.test.ts](/home/krishna/learny-worktrees/m8/server/src/routes/sets.test.ts) — Tests course response, active state, missing sets and escaped notes directories.
- [server/src/routes/sets.ts](/home/krishna/learny-worktrees/m8/server/src/routes/sets.ts) — Serves GET /api/sets/:set/course with confinement and missing-set handling.
- [web/src/api/queries.test.tsx](/home/krishna/learny-worktrees/m8/web/src/api/queries.test.tsx) — Checks that course state refreshes on job transitions, not every progress tick.
- [web/src/components/PlanSetSheet.tsx](/home/krishna/learny-worktrees/m8/web/src/components/PlanSetSheet.tsx) — Accepts initial level/deadline/sources for re-planning.
- [web/src/pages/SetHomePage.tsx](/home/krishna/learny-worktrees/m8/web/src/pages/SetHomePage.tsx) — Places Course plan below the primary next step and prefills current plan settings.
- [server/src/course/build.test.ts](/home/krishna/learny-worktrees/m8/server/src/course/build.test.ts) — Tests stale ticks, note/status/title matches, active draft/rewrite state, subject fallback and no read mutation.
- [server/src/course/build.ts](/home/krishna/learny-worktrees/m8/server/src/course/build.ts) — Derives read-only course state from curriculum, matching notes/statuses and active jobs.
- [web/src/components/CoursePlan.test.tsx](/home/krishna/learny-worktrees/m8/web/src/components/CoursePlan.test.tsx) — Tests states/links, collapse/re-plan, exact draft requests, eligible batch ordering and invalid prerequisites.
- [web/src/components/CoursePlan.tsx](/home/krishna/learny-worktrees/m8/web/src/components/CoursePlan.tsx) — Renders course rows, prerequisite gates, Draft/Draft next 3, progress, links, overflow rewrite, collapse and one-time hint with 44px targets.

## Part-by-part tests (overlap with final verification)

- Part 1: `pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts` — 4 passed, 0 failed; shared tsc passed.
- Part 2: `pnpm --filter @studium/server exec vitest run src/agent/note-lint.test.ts src/agent/tools.test.ts` — 13 passed, 0 failed.
- Part 3: `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts src/jobs/routes.test.ts src/jobs/log.test.ts src/jobs/runner.test.ts src/workspaces/manager.test.ts` — 57 passed, 0 failed.
- Part 3: `pnpm --filter @studium/web exec vitest run src/components/RewriteChapterDialog.test.tsx src/components/Reader/Reader.test.tsx src/api/queries.test.tsx src/components/Activity/JobToasts.test.tsx` — 17 passed, 0 failed; server and web tsc passed.
- Part 4: `pnpm --filter @studium/server exec vitest run src/course/build.test.ts src/jobs/draft-job.test.ts src/jobs/proposals.test.ts src/jobs/routes.test.ts src/routes/sets.test.ts src/agent/roles.test.ts src/agent/chat-service.test.ts src/jobs/runner.test.ts` — 96 passed, 0 failed in the corrected run. An initial new summary assertion expected draft but the checked sample fixture correctly produced checked; the assertion was corrected. No unrelated failures.
- Part 4: `pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx src/components/RewriteChapterDialog.test.tsx src/api/queries.test.tsx` — 6 passed, 0 failed.
- After the browser target-size adjustment: `pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx` — 4 passed, 0 failed.

## Final plan verification

```sh
pnpm --filter @studium/server exec vitest run src/agent/ src/course/build.test.ts src/jobs/draft-job.test.ts src/jobs/routes.test.ts src/jobs/proposals.test.ts src/jobs/runner.test.ts src/jobs/log.test.ts src/routes/sets.test.ts src/workspaces/manager.test.ts src/tree/
# 29 files, 239 passed, 0 failed
pnpm --filter @studium/web exec vitest run src/components/CoursePlan.test.tsx src/components/RewriteChapterDialog.test.tsx src/components/Reader/Reader.test.tsx src/api/queries.test.tsx src/components/Activity/JobToasts.test.tsx src/components/ChatDock/reducer.test.ts
# 6 files, 38 passed, 0 failed
pnpm --filter @studium/shared exec vitest run src/frontmatter.test.ts
# 1 file, 4 passed, 0 failed
pnpm --filter @studium/server exec tsc --noEmit
pnpm --filter @studium/web exec tsc --noEmit
pnpm --filter @studium/shared exec tsc --noEmit
pnpm --filter @studium/web build
# All pass. Build retains the existing >500 kB optional-heavy-chunk warning.
```

Final total: **281 tests passed, 0 failed**. No full-suite run.
Biome checked every changed path, reporting 39 supported code/JSON files with no
fixes needed. The exact expanded command follows:

```sh
rtk proxy pnpm exec biome check AGENTS.md docs/PRINCIPLES.md docs/decisions/LOG.md server/src/agent/chat-service.ts server/src/agent/prompt.ts server/src/agent/roles.test.ts server/src/agent/roles.ts server/src/agent/tools.test.ts server/src/agent/tools.ts server/src/app.ts server/src/jobs/draft-job.test.ts server/src/jobs/draft-job.ts server/src/jobs/log.ts server/src/jobs/proposals.test.ts server/src/jobs/proposals.ts server/src/jobs/routes.test.ts server/src/jobs/routes.ts server/src/jobs/runner.ts server/src/routes/sets.test.ts server/src/routes/sets.ts server/src/workspaces/manager.ts shared/src/api.ts shared/src/frontmatter.test.ts shared/src/schemas.ts skills/.defaults-history.json skills/draft-chapter/SKILL.md skills/fact-check/SKILL.md skills/note-authoring/SKILL.md skills/plan-set/SKILL.md web/src/api/client.ts web/src/api/queries.test.tsx web/src/api/queries.ts web/src/components/Activity/ActivityPanelContent.tsx web/src/components/Activity/JobToasts.tsx web/src/components/PlanSetSheet.tsx web/src/components/Reader/Reader.tsx web/src/pages/JobsPage.tsx web/src/pages/SetHomePage.tsx docs/TEACHING.md server/src/agent/note-lint.test.ts server/src/agent/note-lint.ts server/src/course/build.test.ts server/src/course/build.ts skills/draft-chapter/references/subject-finance.md skills/draft-chapter/references/subject-general.md skills/draft-chapter/references/subject-history.md skills/draft-chapter/references/subject-language.md skills/draft-chapter/references/subject-math.md skills/draft-chapter/references/subject-practical.md skills/draft-chapter/references/subject-science.md skills/draft-chapter/references/subject-technology.md skills/note-authoring/references/teaching.md web/src/components/CoursePlan.test.tsx web/src/components/CoursePlan.tsx web/src/components/RewriteChapterDialog.test.tsx web/src/components/RewriteChapterDialog.tsx
```

`git diff --check` passes. `pnpm install --frozen-lockfile --prefer-offline` ran
first and passed. `node scripts/skill-history.mjs` ran after each skill-edit part;
the manifest was formatted with the required `rtk proxy` Biome command.

## Browser checks

`node /tmp/m8-browser.mjs` — **79 passed, 0 failed**, Chrome via real CDP mouse
input, 390×844 and 1440×900; light, dark, sepia, black and system themes.
Test instance uses a temp copy of examples/sample-set, admin bootstrapped from
test env variables, empty Pi directory, no MCP servers and `STUDIUM_FAUX=1`.
Server/browser ports: 3188/9188. Both started PIDs were saved and stopped; the
server log confirms graceful SIGTERM. No live service was stopped.

Checks cover note state/link rendering, six-row collapse/expansion, prerequisite
explanations, 44px course targets, no horizontal overflow, prefilled re-planning
and Escape, both rewrite menus/confirmation/cancel, exact POST rewrite path, and
real Draft next 3 POSTs for Eigenvalues, Projections and Least squares (skipping
blocked chapters). No uncaught browser errors. Screenshots were visually inspected
for phone/desktop in light/dark; `browser-results.json` records all theme results.
The tutor's ≤30-line course summary is verified in `roles.test.ts`.

Artifacts in this directory: `course-{390,1440}-{light,dark}.png`,
`rewrite-{390,1440}-{light,dark}.png`, `browser-results.json`, `build.log`.
The browser harness closes its EventSources before repeated document navigation;
otherwise rapid reloads exhausted HTTP/1 connections and delayed reader loading.
This was harness handling, with no app change for it.

## Forced integration edits and deviations

- Shared rewrite kind and course response types; workspace handler registration;
  set-route runner plumbing; persisted job-log discriminator; web API union,
  rewrite icon/labels/toast links and query invalidation; skill-history registration.
- Existing generic AI route/enqueue gates already cover every kind except
  compile-book. No gate relaxation/edit was needed; rewrite denial is tested.
- Existing CHAT_JOB_TOOLS already permits start_job. Its schema/proposal/persistence
  handling now permits rewrites; tutor roles do not gain other tools.
- Planned chapter numbering required a minimal reservation change: a missing
  chapter 04 must stay 04 even if chapter 06 exists. Duplicate planned drafts are
  rejected. This is covered by a failed-checker test with out-of-order notes.
- Tick repair also unchecks nonexistent notes, keeping all checkbox mismatches
  consistent with V6. It occurs in the drafter commit, before checking; GET remains read-only.
- A shipped copy of the teaching reference is required because repository docs
  are not copied into user study trees. It matches docs/TEACHING.md.
- Rewrite preservation has deterministic metadata/citation/figure guards in
  addition to the checker; rejected preservation output is restored with exact-string
  conflict protection. Facts remain the checker's model responsibility.
- Browser QA found the existing hint's 32px desktop target; only the Course plan
  instance was enlarged to 44px.

## Not done / open gaps

No plan item was blocked or skipped. Existing Hyderabad notes were not rewritten.
Real-provider prose quality was not tested: models are stubbed/faux as required;
the faux runtime cannot complete a chapter rewrite/draft, so completed outputs and
checker transitions are tested with controlled models. Safari/WebKit was not tested.
No new dependencies, deployment, paid smoke test, repository commit or memory edit.

## Five-line AGENT_MEMORY log entry

2026-10-01 · M8 teaching voice · Parts 1–4 / V1–V6 implemented locally on codex/m8.
Teaching docs/D30, eight subject guides, tolerant PLAN subject, checker teaching blockers and note-write warnings.
Shared draft/rewrite checker pipeline; reader/course rewrite actions; read-only course API/UI and tutor job proposals.
Draft commits tick/repair curricula and reserve planned numbers; next agent: course prerequisites reuse curriculum strings, accepted maps to checked.
281 final tests + 79 browser checks pass; real-model voice and WebKit remain unverified; no live notes or AGENT_MEMORY edits.
