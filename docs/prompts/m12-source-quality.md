# M12 — Source quality + perfect video use (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/m12` on branch `codex/m12`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** `docs/plans/2026-10-04-m12-source-quality.md` — Phases 1–4 and Track V, in order (Track V can interleave with Phases 3–4). Follow its Rules exactly. Don't commit/push/branch; never edit `AGENT_MEMORY.md`, `.env*`, `.claude/`; `data/` read-only (temp copies); only stop processes you started; `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`. If a step doesn't fit the real code, stop that item, report file:line, continue.
