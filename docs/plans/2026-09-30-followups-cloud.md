# M0–M2 follow-ups (Claude cloud task)

**This file is the prompt.** It's self-contained, meant for a Claude Code cloud session on `github.com/krishna-vinci/learny` (branch `main`).

## Ground rules
- Read `AGENTS.md` (testing policy, high-risk areas) and `AGENT_MEMORY.md` (gotchas, system map) first.
- Work on a new branch `claude/followups-m0m2`. Push that branch and open a PR to `main` titled "M0–M2 follow-ups". **Never push to `main` and never merge**: the orchestrator reviews and merges.
- Other agents are changing these areas in parallel. **Do not edit:**
  - `server/src/jobs/{routes,draft-job,plan-job,book-job}.ts`
  - `server/src/routes/{inbox,library,today}.ts`
  - `server/src/today/*`, `server/src/ingest/firecrawl.ts`, `server/src/agent/roles.ts`
  - `web/src/router.tsx`, `web/src/components/Reader/Reader.tsx`, `web/src/components/ChatDock/*`, `web/src/api/*`
  - `web/src/components/AppSidebar/*`
- If a task needs one of those files, stop that task and describe the needed change in the PR description instead.
- No new dependencies. No `.env*`, `data/` or `.claude/` changes. Tests use tmp dirs.
- Targeted tests only (AGENTS.md table). Run biome with `pnpm exec biome check <files>`.
- Setup: Node 22, `pnpm install --frozen-lockfile`.
- If a step doesn't fit the real code, stop that task and explain it in the PR (file:line, what you saw) rather than improvising.

## Tasks (independent; do them in order and commit each one separately on the branch)

### 1. Revert scope (`server/src/routes/sets.ts`, `POST /:set/revert` ~line 205; git helpers in `server/src/tree/git.ts`)
A commit in one set's history may also touch other sets or `library/`, so reverting it from set A could silently change set B.
- Before reverting, list the commit's changed paths (`git show --name-only --format= <sha>`, or a helper in `tree/git.ts`).
- If every path is under `<set>/`, revert as today.
- If some are outside, return **409** `{error:"commit touches paths outside this set", paths:[…outside…]}`, unless the body has `{"scope":"set"}`. In that case revert **only the set's paths**: check out the parent's version of just those paths (a deleted file is removed), then commit `user: revert <short> (set <set> only)` via `commitPaths` with the set paths only.
- Tests in `server/src/routes/sets.test.ts` (tmp repo): a set-only commit reverts; a mixed commit gets 409 without scope; `scope:"set"` reverts only the set file and leaves the other set's file as is.

### 2. Persist pending chat job proposals (`server/src/agent/chat-service.ts` ~line 367 `proposalFromToolResult`; proposals come from `server/src/jobs/proposals.ts`)
Today a Tutor "start job" proposal card exists only in the live event stream, so after a reload it's gone.
- Persist each unexpired proposal with its chat (in the chat's session/metadata store; follow how chat messages are stored).
- Remove it when it's started (`POST /api/jobs {proposalId}` consumes it from `jobProposals`; mirror that removal, e.g. via a hook or by checking liveness on read), dismissed, or expired.
- Add `GET /api/sets/:set/chats/:id/proposals` → `{proposals:[…same shape as the stream event…]}` (only unexpired, still-valid ones) and `DELETE /api/sets/:set/chats/:id/proposals/:proposalId` (dismiss). Put these routes in `server/src/agent/routes.ts` only.
- Tests in `server/src/agent/*.test.ts` with the faux provider: a proposal survives a ChatService restart (new instance, same root); starting or dismissing removes it; expiry.
- UI rendering is not in scope. In the PR description, note the web change needed: on chat load, fetch `/proposals` and render the cards.

### 3. Resumed ingest keeps the URL-derived title (`server/src/jobs/ingest-job.ts` ~line 404)
When an ingest job resumes a pending source (summary pending), the job and source title stay URL-derived instead of the real title.
- On resume, read `library/<id>/source.md` frontmatter `title` (or the parsed title) and call `ctx.setTitle`. Make sure the source record keeps the real title.
- Test in `server/src/jobs/ingest-job.test.ts` (or the nearest existing test).

### 4. Directive attributes in the reader (`web/src/components/Reader/remarkStudium.ts`, `web/src/components/Reader/Directives.tsx`)
`:::definition{title="Rank"}` (and the same for theorem, example, deeper) should render the title in the callout header; today attributes are ignored.
- Parse `{title="…"}` (and optionally `{id=…}`) per remark-directive conventions already used in `remarkStudium.ts`. Render the title after the label, e.g. "DEFINITION · Rank"; for `deeper`, use it as the `<summary>` text.
- Escape: text only, never HTML.
- Test: add to `web/src/components/Reader/Reader.test.tsx` or a new small test for the plugin.
- Also update `docs/STUDY_TREE.md` (the directives section) to document the attribute.

## Done when
- All four are committed on `claude/followups-m0m2` with passing targeted tests, `tsc --noEmit` for the touched packages, and a clean biome.
- A PR is open with:
  - one section per task: what changed, tests run and results
  - anything skipped and why
  - the needed web follow-up for task 2
  - a 5-line log entry per task for `AGENT_MEMORY.md` (the orchestrator adds them)
