# M7 — Media and visuals in notes (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/m7` on branch `codex/m7`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** implement ALL phases (1–6) of `docs/plans/2026-10-01-m7-media.md` exactly, including Fixed decisions F1–F11. Read the whole plan first, then the files it names. Work phase by phase; run each phase's tests before starting the next.

**Local rules:**
- Don't create branches, push, open PRs or commit: the orchestrator reviews and commits.
- Never edit `AGENT_MEMORY.md`: put your 5-line log entry in the final report.
- Never touch `.env*`, `data/` or `.claude/`. Test servers use a temp copy of `examples/sample-set` on your own port (e.g. 3190).
- Only stop processes you started (save `$!`); never pkill or killall.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- Run `pnpm install --frozen-lockfile --prefer-offline` first; add only `vega`, `vega-lite`, `vega-interpreter` (pinned) when you reach Phase 4.
- Use the context7 MCP for remark-directive, pandoc Lua filters, Typst images and Vega APIs.
- Standing permission: minimal integration edits the plan's items force (tool registration, role allowlists, route mounts, type unions, PWA cache entry, skill-history registration). List them in the report.
- If a step doesn't fit the real code, stop that item and report file:line; continue with the others.

Finish with the plan's verification commands and the final report: changed files per phase, tests with pass/fail counts, browser-check results, deviations and open gaps, 5-line log entry.
