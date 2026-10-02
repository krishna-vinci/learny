# YouTube embeds robust end-to-end (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/yt` on branch `codex/yt`. Do not load orchestration skills and do not spawn sub-agents.

**Local rules:** don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry in the report); never touch `.env*` or `.claude/`; `data/` is **read-only** (read real notes, never write there — copy to a temp dir for any test server); test servers on temp copies on your own port (admin from env, `STUDIUM_FAUX=1`); only stop processes you started (save `$!`), never pkill/killall; run `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`; use real clicks in browser checks (390×844 and 1440×900, light and dark).
**Context:** M7 (D29, `docs/plans/2026-10-01-m7-media.md` + its report) already shipped media in notes: `::youtube{…}` / `::artifact{…}` leaf directives, `YouTubeEmbed.tsx` (click-to-load, nocookie), `ArtifactBlock.tsx` (CSP-prepended `sandbox="allow-scripts"`), `shared/src/media.ts`, `skills/media-authoring/`, and the book (`server/src/jobs/book-media.ts`, `callouts.lua`) — the Typst book already exists, it is not future work. Read these first. If a step doesn't fit the real code, stop that item, report file:line, and continue.

Final report: design decisions, changed files, tests with pass/fail counts, browser-check results, deviations, 5-line log entry.

---

Task: YouTube videos in Studium notes are not working reliably, in two ways: (1) agents are not finding/picking the right video links well — e.g. when a chapter is built from a YouTube source, the note often doesn't end up with a link/embed where it should, or uses a wrong/odd URL; (2) embedding is unreliable — some YouTube links in notes render as embeds, others silently don't.

Your job: make video embedding robust end-to-end, and prove it with tests.

Investigate the whole chain yourself — how a video enters the system (source ingest), how agents are taught to reference videos (skills), how notes end up containing links, and how the reader turns those links into an embed. Find where links get lost or malformed, and where the embed step is too strict or too loose about the link forms it accepts.

Fix both sides: agents should reliably surface the video (with a timestamp when the transcript supports it) in notes built from video sources, and the reader should accept the realistic spread of YouTube URL forms people and agents actually produce — watch/share/shorts/embed/mobile/music variants, with or without query params, pasted bare, markdown-linked, or in the app's directive syntax — while still rejecting junk safely.

Then test it well: unit tests over the realistic matrix of link forms (including odd-but-valid ones and near-miss invalid ones), plus a check against the real notes already in the user's study tree under data/users/ — render a sample of existing notes and verify every YouTube link in them produces a correct embed, collecting any that don't. Don't declare it done until the existing real-world content renders.

Non-negotiables: notes stay plain markdown that opens fine in Obsidian/GitHub; no raw-HTML escape hatch into the sanitizer; the embed component must not introduce an XSS surface. Work within the existing locked decisions (docs/decisions/LOG.md) and update the relevant skill/docs text if the syntax taught to agents turns out to be the weak link. Per AGENTS.md: scoped tests only, no commits.
