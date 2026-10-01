# M4-8 web follow-up (small, precise)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/m4-8web` on branch `codex/m4-8web`. Do not load orchestration skills and do not spawn sub-agents. Read `AGENT_MEMORY.md` and `docs/UX.md` (copy and interaction rules) first.
- Only edit `web/`. Never commit, push or edit `AGENT_MEMORY.md`. Never pkill.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step doesn't fit the code, stop and report file:line.

The server already provides the fields used below (see `shared/src/api.ts` and `docs/prompts/m4-8-fixes-report.md`, section "Deferred web changes").

1. **`web/src/api/queries.ts`** (the SSE handler that invalidates the Today query): invalidate Today on `commit` and `file` events and on a job event only when that job's `status` changed since the last event for the same `job.id` (keep a small `Map<id, status>`). Don't invalidate on progress-only ticks.
2. **`web/src/pages/InboxPlanReview.tsx` (+ `web/src/pages/plan-proposal.ts`):** use the API's `chapters` array (`{number, title, scope, prerequisites, ticked}`) from `GET …/plan-proposals/:file` instead of parsing the curriculum Markdown. The preview lists exactly `chapters.filter(c => !c.ticked).slice(0, draftFirst)` as "These chapters will be drafted now", and submits that count. Remove the now-unused Markdown parsing and update or remove its test accordingly.
3. **`web/src/pages/TodayPage.tsx`:** use `chaptersToReview` and `plansToReview` instead of the old inbox count. For example, "2 chapters to review" and "1 study plan to review" (the plain words from `docs/UX.md`), each shown only when > 0. Distinguish do-next items by `reviewKind`, and include `reviewKind` in list keys.
4. **`web/src/pages/TodayPage.tsx`:** hide the "N topics due for practice →" link on a set card when N is 0 (it's noise on every card). Also hide any other zero-count line on those cards.

## Checks
- `pnpm --filter @studium/web exec tsc --noEmit`
- `pnpm --filter @studium/web exec vitest run src/pages src/api`
- biome on the changed files
- `pnpm --filter @studium/web build`

Report the changed files and test results.
