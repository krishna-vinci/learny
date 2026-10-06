# Delete notes, chapters and sets (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/delete` on branch `codex/delete`. Do not load orchestration skills or spawn sub-agents. Run `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`. Note: since this prompt was written, chapters match notes by `chapter:` id/title/slug (not filename number) and Course plan lists "Other notes in this set" — deleting a chapter note must keep that consistent. Another agent is concurrently changing media briefs/figures (server/src/tree/media-brief.ts, jobs/media-plan.ts, ingest/figures.ts): avoid editing those files; if deletion needs to clean a chapter media brief (`<set>/media/NN-slug.md`), do it through the tree layer and report it.

---

# Delete notes, chapters and sets — safely and recoverably

Work in your own worktree/branch; don't commit, push or merge. Read `AGENTS.md` (high-risk: `server/src/tree/`, git auto-commit, Anki export), `AGENT_MEMORY.md`, `docs/STUDY_TREE.md`, `docs/decisions/LOG.md` first. If something doesn't fit the code, stop that item and report file:line.

## Problem (evidence)
Nothing a learner creates can be removed. `server/src/routes/sets.ts` has create (`POST /:set/notes`), save (`PUT /:set/file`) and revert, but no delete; the server's other deletes cover sessions/tokens/users only. Manual notes, drafted chapters (including junk like `hyderabad-history/notes/07-test.md`) and whole sets live forever. A chapter is a note file in `<set>/notes/` plus a row in `<set>/curriculum.md` (course state is derived from file presence, `server/src/course/build.ts`). Linked data: card files in `<set>/cards/` (Anki note GUID = card id; exported cards live in the user's Anki), chapter-owned `visuals/`, `assets/`, `artifacts/`, highlights/practice records.

## Goal
Learners can delete a note/chapter and a whole set. Deletion flows through the tree layer (confinement, per-file locks, a git commit authored as the user), stays recoverable from history, handles or clearly surfaces everything linked to what's deleted, and can never touch anything outside that learner's own set root. The API shape and UX are yours to design.

## Rulings (orchestrator)
- **Scope:** notes and chapters **and** whole sets, now.
- **UX:** note/chapter delete = immediate with an **Undo** toast (git revert of the deletion commit) plus a short confirm only when linked data will also go. Set delete = typed confirmation (the set name) because of blast radius, then a "Recently deleted" place (settings or Library) listing deleted sets/notes from git history with **Restore**.
- **Linked-data defaults:**
  - **Curriculum row:** kept, so the chapter becomes "planned" again and can be re-drafted. Offer "also remove from the plan" as an option.
  - **Derived card file** for that note: deleted with it.
  - **Exported Anki cards:** never touched (we never write to Anki). Tell the learner how many cards were exported and that they can remove them in Anki.
  - **Media** (`visuals/`, `assets/`, `artifacts/`) referenced **only** by the deleted note: deleted. Media shared with other notes: kept.
  - **Highlights/practice records** tied to the note: removed or tolerated as orphans, without breaking any page.
- **Separate from the editor work** (that's its own prompt).

## Hard constraints
- Path confinement: realpath, no symlink escape, only inside `<user tree>/<set>/`; `library/`, `_global/` and other sets are never deletable through these routes.
- Git: deletions are new commits; never rewrite history (no reset, rebase or force). Restore = revert.
- Never write to Anki. AI gating doesn't apply (no model calls).
- Tests on temp-dir copies only; whole `server/src/tree/` test dir runs (high-risk area).

## Verify
- Server tests: delete note/chapter/set happy paths; confinement attacks (`..`, symlinked note pointing outside, `library`, another set, `_global`); lock contention; card file and media policies; undo/restore round-trips byte-for-byte; course state after deleting a chapter (planned again).
- Browser check (real clicks, 390×844 and 1440×900): delete from the reader and the set page, undo, set delete with typed confirm, restore from "Recently deleted".
- Scoped tests, `tsc --noEmit` server/web/shared, web build, biome on changed files. Report: changed files, tests with counts, deviations, a 5-line log entry.
