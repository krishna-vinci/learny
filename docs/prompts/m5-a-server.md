# M5-A — Practice: server (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/m5` on branch `codex/m5`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** implement **"PR A: server"** of `docs/plans/2026-10-01-m5-practice.md` exactly, including all its Fixed decisions D1–D9. Read the whole plan first.

**Local rules** (they REPLACE the plan's cloud "Ground rules" about branches and PRs; the rest of the plan's rules still apply):
- Don't create branches, push, open PRs or commit: the orchestrator reviews and commits.
- Never edit `AGENT_MEMORY.md`: put your 5-line log entry in the final report.
- Never touch `.env*`, `data/` or `.claude/`.
- Only stop processes you started (save `$!`); never pkill or killall.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- The web part (PR B) comes as a follow-up message in this same session. For now only change `web/` where the plan says PR A must (the `KIND_ICONS` entries), and run the web `tsc`.
- Standing permission: minimal integration edits the plan's items force (route mounts, job registration, type unions, AI gate, log regex, the settings role list, git author identities). List them in the report.
- If a step doesn't fit the real code, stop and report file:line.

Finish with the plan's PR A test commands and the final report (changed files, tests with results, deviations, log entry).
