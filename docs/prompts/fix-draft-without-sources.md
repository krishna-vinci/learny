# Fix — chapter drafts fail when the plan's sources were never added (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/draft-sources` on branch `codex/draft-sources`. Do not load orchestration skills and do not spawn sub-agents.

## The bug (seen live, 2026-10-01)
1. The user asked the agent to plan a new set ("Hyderabad History"). The outliner's proposal listed **Sources to add** (URLs) but `PLAN.md` has `sources: []`.
2. The user approved with "draft first N". `server/src/routes/inbox.ts` (approve, ≈ lines 95–165) enqueued N `draft-chapter` jobs immediately with `sources: []`. Nothing ever added the proposed sources.
3. Each drafter ran one model turn (~15k in / ~280 out tokens, ~15 s, ~$0.08), refused to write uncited content (`skills/draft-chapter/SKILL.md:12,25`) and stopped. `server/src/jobs/draft-job.ts:290` then threw `drafter must create exactly notes/01-….md`, which the user saw five times. "Retry" repeats the same failure because the job input still carries `sources: []`.

## Fix (all four parts)

**A. Approval adds the proposed sources, then drafts.**
- `POST /api/sets/:set/plan-proposals/:file/approve` (body unchanged plus optional `addSources: boolean`, default `true`): when the proposal has `sourcesToAdd` (parsed in `server/src/inbox/plans.ts`) and `addSources` is true, enqueue one ingest job per URL through the same code path the Library "add source" route uses, linked to the set (so a successful ingest adds the id to `PLAN.md` `sources`, as linking does today — check how; if linking doesn't update PLAN.md, do that in the kickoff below).
- Don't enqueue the drafts yet. Persist a **kickoff** record per set in the workspace (e.g. `.cache/plan-kickoffs.json`, same persistence/reload-at-boot pattern as `server/src/ingest/site-queue.ts`): `{set, ingestJobIds, chapters: [{title, brief}], createdAt}`.
- Listen for job completion (the same event the site queue or job toasts use). When every ingest job of a kickoff has finished (done or failed): enqueue the draft jobs with `sources` = the ids that ingested successfully plus `PLAN.md` sources, then delete the record. If none succeeded and the set still has no sources, enqueue nothing and leave a clear failed-state trace the UI can show (e.g. the kickoff fails with "Couldn't add any of the plan's sources").
- Response: `{sha, jobIds, ingestJobIds}` (`jobIds` = drafts enqueued now; empty while waiting). No proposal sources, or `addSources: false` → today's behaviour.
- Draft jobs must never wait inside a runner slot (deadlock with `maxParallelJobs`): only enqueue them once ingests settle.

**B. Drafts fail fast and cheaply without sources.** At the start of the draft handler, before any model call, resolve sources at run time: `input.sources` ∪ `PLAN.md` `sources`, keeping only ids that exist under `library/`. If the result is empty, throw a plain error: `This set has no sources yet. Add a source in the Library (or ask the tutor to find some), then retry.` No model call, no cost. Use the resolved list for the drafter task — this also makes **Retry** work once sources exist.

**C. When the drafter writes nothing, say why.** Replace the bare `drafter must create exactly …` with `The drafter stopped without writing the chapter: <its last assistant text, trimmed to 300 chars>` when nothing was written. Keep the existing message for the case where it wrote a forbidden path.

**D. Web (small).**
- Inbox plan review (`web/src/pages/InboxPage.tsx` plan view): when the proposal has sources to add, the approve button reads **"Add N sources & draft first K"**, and a line under it says drafting starts after the sources are added. Toast after approve: "Adding N sources — chapters will be drafted after".
- Map the B error in `web/src/lib/friendly-errors.ts` to a friendly message with the action "Add a source" → the Library add-source sheet (or the Library page if a direct link is awkward). Add a test there.

## Rules
- Read `AGENTS.md` and `AGENT_MEMORY.md` first. Don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry goes in your report); never touch `.env*`, `data/`, `.claude/`; only stop processes you started; biome via `rtk proxy pnpm exec biome check <files>`.
- Run `pnpm install --frozen-lockfile --prefer-offline` first. No new dependencies.
- Tests (stub models and ingest; no network): approve with sources → ingests enqueued, no drafts; ingests settle → drafts enqueued with the new ids; kickoff survives a restart (reload from disk); all ingests fail → no drafts; approve without sources → old behaviour; draft with no sources → fails before any model call; drafter writes nothing → the new message with its last text; friendly-error mapping.
- Run: the test files you touched/added in `server/src/routes/`, `server/src/jobs/`, `server/src/inbox/`, plus `pnpm --filter @studium/server exec tsc --noEmit`, `pnpm --filter @studium/web exec tsc --noEmit`, the web test for friendly-errors and InboxPage if one exists, biome on changed files.
- Standing permission: minimal integration edits these items force (workspace wiring for the kickoff store, event subscription, response types in `shared/`). List them.
- If a step doesn't fit the real code, stop that item and report file:line.

Final report: changed files, tests with pass/fail counts, deviations, 5-line log entry.
