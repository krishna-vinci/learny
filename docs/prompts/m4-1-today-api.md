# M4-1 — Today API

You are the IMPLEMENTER in /home/krishna/learny-worktrees/m4-1 on branch codex/m4-1 (a git worktree of /home/krishna/learny). Do not load orchestration skills and do not spawn sub-agents. Read `/home/krishna/learny/AGENT_MEMORY.md` first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

Rules:
- Never commit or push.
- Never touch `.env*`, `data/`, `.claude/` or `web/`. UI comes later, from Sonnet.
- Only stop processes you started yourself (save `$!`); never `pkill` or `killall`.
- Tests are targeted per AGENTS.md; tests use tmp dirs, never real `data/`.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
- Standing permission: minimal integration edits your task forces (imports, a route mount line in `server/src/app.ts`, type unions in `shared/src/api.ts`). List each one in the report.

End with the AGENTS.md final report plus a 5-line log entry for AGENT_MEMORY.md.


## Goal
`GET /api/today` (per user, through the workspace app) returns everything the Today page needs, across all the user's sets. No Anki stats (D23).

## Where
- New `server/src/routes/today.ts` exporting `todayRoutes({ root, jobs })`, mounted in `server/src/app.ts` like the other routes (`app.route("/api/today", …)`).
- Pure logic in `server/src/today/build.ts` (+ `build.test.ts`).
- Types `TodayView`, `TodaySet` and `TodayItem` in `shared/src/api.ts`.

## Data per set (`tree/read.ts` `listSets` for slug, title, status, level, deadline, nextAction)
- `daysLeft` from `deadline` (null if none; negative = overdue)
- `inboxCount`: chapters awaiting review. Reuse the inbox listing logic from `server/src/routes/inbox.ts`; factor a shared function if it's only in the route.
- `draftCards` and `staleCardFiles` from `cards/store.ts` `listCardFiles` (it already reports counts/stale)
- `runningJobs`: queued or running jobs for the set (`JobRunner.list(set)`)
- `lastStudiedAt`: the newest `user:`-authored commit or chat activity for the set (`tree/git.ts` `log` with a path filter; chat files are gitignored, so use the chat files' mtime under `<set>/chats/`)
- `nextChapter`: the first unchecked item in `<set>/curriculum.md` if present (checkbox list), else null
- `notesCount`

## "Do next" list (max 7, ordered)
1. Overdue sets (`daysLeft < 0`) with an inbox or nextAction.
2. Chapters awaiting review (inbox).
3. Draft cards to review.
4. Stale cards.
5. The next chapter to draft (from the curriculum) for active sets due soonest.
6. Sets not studied in 7+ days.

Each item: `{kind, set, title, detail, href}` with an app route, e.g. `/s/<set>/inbox`, `/s/<set>/cards`, `/s/<set>`.

## Tests
Unit tests for `build.ts`: ordering, overdue, the curriculum parse, empty sets. One route test through `createApp` with a temp copy of `examples/sample-set`.
- `pnpm --filter @studium/server exec vitest run src/today src/routes/today.test.ts src/routes/inbox.test.ts`
- `tsc --noEmit` for server and shared
