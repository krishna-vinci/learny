# Visuals out of the reading flow (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/visuals` on branch `codex/visuals`. Do not load orchestration skills and do not spawn sub-agents.

**Local rules:** don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry in the report); never touch `.env*` or `.claude/`; `data/` is **read-only** (read real notes, never write there — copy to a temp dir for any test server); test servers on temp copies on your own port (admin from env, `STUDIUM_FAUX=1`); only stop processes you started (save `$!`), never pkill/killall; run `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`; use real clicks in browser checks (390×844 and 1440×900, light and dark).
**Context:** M7 (D29, `docs/plans/2026-10-01-m7-media.md` + its report) already shipped media in notes: `::youtube{…}` / `::artifact{…}` leaf directives, `YouTubeEmbed.tsx` (click-to-load, nocookie), `ArtifactBlock.tsx` (CSP-prepended `sandbox="allow-scripts"`), `shared/src/media.ts`, `skills/media-authoring/`, and the book (`server/src/jobs/book-media.ts`, `callouts.lua`) — the Typst book already exists, it is not future work. Read these first. If a step doesn't fit the real code, stop that item, report file:line, and continue.

Final report: design decisions, changed files, tests with pass/fail counts, browser-check results, deviations, 5-line log entry.

---

**Sequencing:** the YouTube-robustness task has just merged into `main`; build on it (YouTube embeds stay inline unless you argue otherwise). Your D-entry supersedes the inline-artifact part of D29; say so explicitly.

Task: Rethink how interactive visuals (HTML animations/sims and similar rich media) appear in Studium, moving them out of the reading flow into their own space.

Problem: the current/planned approach embeds interactive content inline inside the chapter text. That clutters reading, creates friction with the future Typst/PDF book export (static medium can't play them), and forces agents to squeeze artifacts into a narrow inline slot.

Direction: the reader gets a toggle — the chapter text stays clean for reading, and a dedicated "Visuals" view (second tab in the reader, or an equivalent pattern you judge better) shows all visual/interactive content belonging to that chapter in its own full space. Learner reads prose; when they want to play, they switch tabs. This sidesteps the PDF problem entirely (the book just carries a pointer/fallback to the visuals) and gives agents a bigger, simpler canvas.

You own the design within these rails:
- How visuals are associated with a chapter and discovered by the reader (files in the study tree, note frontmatter, a listing in the note, or whatever is cleanest per docs/STUDY_TREE.md) — decide and write it down.
- How agents create and attach visuals (update the relevant skills), so it's easy: they produce the artifact file(s) and reference them, without inline-layout constraints.
- The reader UX: where the toggle lives, what the visuals tab shows (list/gallery of that chapter's visuals, each opened full-width), loading/empty states, mobile behavior.
- Sandboxing stays strict: agent-generated HTML runs in a sandboxed iframe without same-origin, per docs/DEPLOY.md and AGENTS.md's high-risk area notes. Add/extend tests for the sandbox guarantees specifically.
- The book/PDF story: define what a chapter's compile carries for each visual (static fallback, poster, or link) and record it in docs/decisions/LOG.md so the book work builds on it.
- Migrate whatever inline-embed support exists for sims to the new model (YouTube embeds may stay inline — they're passive; use judgment and state it).

Per AGENTS.md: scoped tests, no commits, small reviewable diffs (this may be worth splitting into reader-UX, artifact-plumbing, and skills/docs pieces — your call, say so in your report).
