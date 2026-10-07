# M4-4 — Outliner role + plan-set job + plan approval

You are the IMPLEMENTER in /path/to/studium-worktrees/m4-4 on branch codex/m4-4 (a git worktree of /path/to/studium). Do not load orchestration skills and do not spawn sub-agents. Read `AGENT_MEMORY.md` (in your worktree) first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

Rules:
- Never commit or push. Never edit `AGENT_MEMORY.md` anywhere: put your 5-line log entry in the final report.
- Never touch `.env*`, `data/`, `.claude/` or `web/` (UI comes from Sonnet).
- Only stop processes you started (save `$!`); never pkill or killall.
- Targeted tests per AGENTS.md, in tmp dirs.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
- Standing permission: minimal integration edits your task forces (imports, route mounts in `server/src/app.ts`, job registration in `server/src/workspaces/manager.ts`, type unions in `shared/src/api.ts`, the jobs route validator). List each one in the report.

End with the AGENTS.md final report plus the log entry.


## Goal
The learner gives a goal, and the Outliner agent proposes a study plan: a `PLAN.md` draft and a `curriculum.md` chapter list. The learner approves it in the Inbox, and the first N chapters are queued as `draft-chapter` jobs. Spec: `docs/AGENT_ROLES.md` ("Plan: Outliner → PLAN.md draft → user approves").

## Pieces
1. **Role** `outliner` in `server/src/agent/roles.ts` (see `ROLES`, ~line 34, and the `RoleName` type):
   - tools: study-tree read, `RESEARCH_TOOLS`, `SKILL_TOOLS`
   - MCP: `["searxng", "papers", "context7"]`
   - skills: `["plan-set", "find-sources"]`
   - write policy: ONLY `<set>/plan-proposals/*.md`
   - model role key `outliner`: remove it from `FUTURE_ROLE_KEYS` in `server/src/routes/settings.ts:18` so it shows in the Settings role map
   - no `add_source` (it proposes sources as URLs)
2. **Skill** `skills/plan-set/SKILL.md`. Given goal, level, deadline, the learner profile and the chosen library sources:
   - write a proposal file `<set>/plan-proposals/<timestamp>.md` with two fenced sections: the full proposed `PLAN.md` (same frontmatter schema as existing `PLAN.md`: title, status, level, deadline, sources, next_action; plus Goal and Scope in/out) and the proposed `curriculum.md` (checkbox list `- [ ] NN — Title` with one-line scope and prerequisites)
   - 6–14 chapters, ordered by prerequisites, sized for the level
   - a "Sources to add" list (URLs from find-sources, not registered)
   - afterwards, run `node scripts/skill-history.mjs` so skill sync knows the new default
3. **Job** kind `plan-set`:
   - `shared/src/api.ts:101` `JobKind`, `server/src/jobs/plan-job.ts` (model it on `draft-job.ts`)
   - registration in `workspaces/manager.ts` (~line 168), `jobs/routes.ts` validator (~line 38)
   - input `{set, goal, level?: 1-5, deadline?: YYYY-MM-DD, sources?: string[]}`
   - if the set doesn't exist yet, the route creates it first with `createSet` (`server/src/tree/authoring.ts`, from `POST /api/sets`)
   - progress text; the result carries `proposalPath`
4. **Inbox item** for plans. Extend `InboxItem` (`shared/src/api.ts:143`) with `kind: "chapter" | "plan"` (default "chapter", so existing items don't change) and list pending proposals from `server/src/inbox/read.ts`. Routes in `server/src/routes/inbox.ts`:
   - `GET /api/sets/:set/plan-proposals/:file` returns the parsed proposal (`plan`, `curriculum`, `sourcesToAdd`)
   - `POST .../:file/approve {draftFirst: 0-5 (default 3)}` writes `PLAN.md` and `curriculum.md` (atomic, under locks), deletes the proposal, commits `user: approve plan`, and enqueues `draft-chapter` jobs for the first N unticked chapters (title from the curriculum line; brief = its scope line; sources = plan sources)
   - `POST .../:file/discard` deletes the proposal and commits
5. **Curriculum fix** (open gap in AGENT_MEMORY): make the Today "next chapter" logic (`server/src/today/build.ts`) skip curriculum items whose chapter note already exists (match the `NN` prefix or a slugified title against `notes/`). When a draft-chapter job finishes, tick its curriculum line if one matches: a small helper in `draft-job.ts`, committed with the chapter.

## Tests
- plan-job: faux provider writes a proposal; bad input rejected; a new set is created
- inbox: lists the plan; approve writes the files, queues N jobs (stub runner) and commits as user; discard
- write policy: the outliner can't write `notes/` or `PLAN.md`
- Today skips existing chapters; curriculum ticking

Run:
- `pnpm --filter @studium/server exec vitest run src/jobs src/routes/inbox.test.ts src/inbox src/today src/agent src/tree`
- `tsc` for server and shared
