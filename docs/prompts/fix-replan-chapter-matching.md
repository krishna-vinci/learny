# Fix: after a re-plan, old notes block new chapters (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/replan-fix` on branch `codex/replan-fix`. Don't load orchestration skills or spawn sub-agents. Don't commit/push/branch; never edit `AGENT_MEMORY.md`, `.env*`, `.claude/`; `data/` read-only (temp copies); only stop processes you started; `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`. If a step doesn't fit the real code, stop that item, report file:line, continue.

## Bug (live, 2026-10-06)
The owner re-planned `polymers`. New curriculum: 01 "Atoms, molecules and the chemistry around you", 02 "Bonds and simple molecular drawings". Existing notes: `notes/01-polymers-from-carbon-bonds-to-everyday.md` (old chapter) and `notes/02-ch-2.md` (a tiny test note). Draft jobs for the new 01 and 02 ran ~5½ minutes each (55–67k tokens, ~$0.11 each, Exa calls) and then failed with "This chapter already has a note. Use rewrite-chapter to revise it." The owner sees no such chapters.
- `chapterExists` (`server/src/tree/curriculum.ts:60-70`) treats a note as the chapter when its **filename number** equals the chapter number, even if the title is entirely different. It is used by `draft-job.ts`, `course/build.ts`, `today/build.ts`, `tree/media-brief.ts`, `jobs/source-preflight.ts`.
- The reservation/existence check (`reserveNotePath`, `draft-job.ts` ≈ 264–292) runs **after** `sourcePreflight` (≈ 429), so the failure costs a full research pass.

## Goal
Chapters are matched to notes by identity (title/slug, or an explicit chapter id stored in the note's frontmatter if you add one — keep old notes working), never by number alone. After a re-plan, old notes that match no planned chapter don't block anything, stay visible, and new chapters draft normally. Invalid drafts fail before any model/search work.

## Requirements
1. Replace number-only matching everywhere `chapterExists` is used. A note with the same number but a clearly different title is not the chapter. Keep matching for genuine cases (same slug; a renamed title where frontmatter `title`/chapter id matches). Consider writing a stable `chapter:` id (e.g. the curriculum slug) into new drafts' frontmatter and preferring it when present (tolerant schema; old notes without it still match by slug).
2. When the chapter's number is taken by a non-matching note, reserve a fresh, unique filename (e.g. next free number or `NN-slug` with a non-colliding slug) while the note's frontmatter `order` follows the curriculum. Make reader/note-list ordering consistent: planned chapters in curriculum order first, then notes not in the plan (by their order/title). Don't rename or rewrite existing user files.
3. Move every cheap validity check (chapter exists, already being drafted, path reservation) **before** `sourcePreflight` and any model or Exa call; a refused draft costs nothing. Test that no model/search fake is invoked on refusal.
4. Error copy names the conflict: "Chapter 1 is already the note “<title>”. Use Rewrite to revise it." (only when it truly is that chapter).
5. Course API + `CoursePlan`/Plan page: list notes that match no planned chapter under "Other notes in this set" (title + link), so nothing is hidden after a re-plan. Today must not count them as planned chapters.
6. Tests: the polymers scenario (old 01/02 notes, new curriculum 01/02 with different titles) → both new chapters draftable, course shows 2 planned + 2 other notes; genuine existing chapter still refused cheaply; renamed-title chapter with matching `chapter:` id still recognised; media-brief/preflight/today use the new matcher.

Verify: scoped tests (touched files + `server/src/tree/`, `server/src/jobs/draft-job.test.ts`, `server/src/course/`, `server/src/today/`, `server/src/jobs/source-preflight.test.ts`, `server/src/tree/media-brief.test.ts`, web `CoursePlan`/`PlanPage` tests), tsc server/web/shared, biome. No browser screenshots needed. Final report: changed files, tests with counts, deviations, 5-line log entry.
