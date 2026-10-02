# M9 — Visuals that teach (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/m9` on branch `codex/m9`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** implement ALL four parts of `docs/plans/2026-10-02-m9-visuals.md` in order, with Fixed decisions V1–V11. Read the whole plan and the files it lists first. After each part, run that part's tests and write a short part summary into `docs/plans/2026-10-02-m9-visuals-report.md` before starting the next (so progress survives a network cut). Use the context7 MCP for p5, d3, three, Vite static assets and the chosen expression parser. For the frontend use the `ui-ux-pro-max` and `shadcn` skills if available and match existing Reader styles.

**Local rules:** don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry in the report); never touch `.env*`, `.claude/`; `data/` is read-only (examples go in `examples/sample-set`); test servers on temp copies on your own port (admin from env, `STUDIUM_FAUX=1`); only stop processes you started (save `$!`), never pkill/killall; run `pnpm install --frozen-lockfile --prefer-offline` first; new deps only per V9, exact pins; biome via `rtk proxy pnpm exec biome check <files>`; real clicks in browser checks. Note: the Jev spike runs in another worktree and may change Pi versions later — don't touch Pi packages or `patches/`. If a step doesn't fit the real code, stop that item, report file:line, continue.

Final report (in the report file and as your last message): per part — changed files, tests with pass/fail counts, browser results, bundle sizes, dependency justification, deviations; then a 5-line log entry.
