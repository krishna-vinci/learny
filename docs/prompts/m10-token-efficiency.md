# M10 — Token efficiency + classifier layer (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/m10` on branch `codex/m10`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** implement Parts 1–3 of `docs/plans/2026-10-02-m10-token-efficiency.md` with C1–C4, in order. Part 1 (audit + non-classifier savings) first; write its before/after numbers into `docs/plans/2026-10-02-m10-token-efficiency-report.md` before starting Part 2, and append each later part's summary there too (progress must survive a network cut). The Jev API shape is proven in branch `codex/jev` (`git show codex/jev:server/src/spikes/jev-spike.ts` etc.) — reuse, don't merge that branch.

**Local rules:** don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry in the report); never touch `.env` (reading it only via `--env-file` into a single spike/smoke process is allowed; never print keys) or `.claude/`; you may edit `.env.example` as the plan says; `data/` is read-only — copy trees to a temp dir for audits; real-model spend ≤ $2 total, report it; only stop processes you started (save `$!`), never pkill/killall; run `pnpm install --frozen-lockfile --prefer-offline` first; no new dependencies; biome via `rtk proxy pnpm exec biome check <files>`. If a step doesn't fit the real code or the audit shows an item isn't worth it, skip it with numbers and file:line in the report, and continue.

Final message: per part — changed files, tests with pass/fail counts, audit before/after per role, spend, deviations; then a 5-line log entry.
