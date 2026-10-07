# M13 — Search backends, subjects, refresh sources (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/m13` on branch `codex/m13`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** `docs/plans/2026-10-05-m13-search-backends.md`, Parts 1–4 in order; follow its Rules. Don't commit/push/branch; never edit `AGENT_MEMORY.md`, `.env*`, `.claude/`; `data/` read-only (temp copies); keys only via `--env-file` into script processes, never printed; only stop processes you started; `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`. If a step doesn't fit the real code, stop that item, report file:line, continue.
