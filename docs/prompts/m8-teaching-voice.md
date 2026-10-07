# M8 — Teaching voice (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/m8` on branch `codex/m8`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** implement ALL parts (1–4) of `docs/plans/2026-10-01-m8-teaching-voice.md`, including V1–V6. Read the whole plan and the live Hyderabad chapters it cites (read-only) first. Work part by part; run each part's tests before the next. For the frontend, use the `ui-ux-pro-max` and `shadcn` skills if available, and match the existing set home styles.

**Local rules:**
- Don't create branches, push, open PRs or commit: the orchestrator reviews and commits.
- Never edit `AGENT_MEMORY.md` (log entry in the report). Never touch `.env*`, `data/` or `.claude/`; test on temp copies.
- Only stop processes you started (save `$!`); never pkill or killall.
- Run `pnpm install --frozen-lockfile --prefer-offline` first. Biome via `rtk proxy pnpm exec biome check <files>`.
- Standing permission: minimal integration edits the plan forces (job registration, route mounts, type unions, AI gate, job icons/labels, skill-history). List them.
- If a step doesn't fit the real code, stop that item and report file:line; continue with the others.

Finish with the plan's verification commands and the final report: changed files per part, tests with pass/fail counts, browser-check results, deviations and open gaps, 5-line log entry.
