# Jev classifier spike (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/path/to/studium-worktrees/jev` on branch `codex/jev`. Do not load orchestration skills and do not spawn sub-agents.

**Spec:** execute Phases 0–2 of `docs/plans/2026-10-02-jev-classifier-spike.md`. Phase 3 is NOT in scope.

**Corrections to the plan (the plan's text is wrong here; follow these):**
- There is no `npm run check` or `./test.sh`. Gates = `pnpm --filter @studium/server exec tsc --noEmit`, `pnpm --filter @studium/web exec tsc --noEmit`, and the scoped vitest dirs most exposed to Pi: `src/agent/ src/jobs/ src/mcp/ src/routes/` in `@studium/server` (this is an explicit request to run those dirs), plus `pnpm --filter @studium/web build`. Package filter is `@studium/server`, not `server`.
- Cards live in `data/users/<user>/<set>/cards/*.md` (each file holds several cards), not `_cards/`. Chapters in `<set>/notes/*.md`; checker reports in `<set>/log/checks/`. There are only ~4 card files today: use every real card and every real chapter section you can find; if under the plan's sample sizes, say so — never synthesise data.
- **Pi patch:** we carry `patches/@earendil-works__pi-ai@0.87.1.patch` (fixes quadratic `parseStreamingJson` that froze the server; see AGENT_MEMORY gotchas). On upgrading to 1.0.0, check whether 1.0.0 still has the quadratic re-parse; if yes, recreate the patch for 1.0.0 with `pnpm patch` / `pnpm patch-commit` and update `pnpm-workspace.yaml`; if fixed upstream, remove the patch entry. Prove it with the same benchmark (280 KB streamed in 20-char chunks must finish in well under 1 s).
- **API key:** no OpenCode credentials exist yet (`~/.pi/agent/auth.json` has github-copilot, zai, openai-codex, anthropic; `OPENCODE_API_KEY` is unset). Check `process.env.OPENCODE_API_KEY` / the runtime's auth at start. If missing: complete Phase 0, build the full harness with a `--dry-run` mode, run the **baseline** LLM side for real, and stop before Jev calls — report "blocked on OPENCODE_API_KEY". Never ask for, print or store keys.
- Baseline uses real models (it's a measurement): read `_global/config.yaml` for role models, keep total baseline spend under ~$3, and report it. Read `data/` strictly read-only: copy study trees to a temp dir before running anything that might write (role runs write files/commits).
- Put the spike script under `server/src/spikes/` and raw results as JSON next to the report (`docs/plans/2026-10-02-jev-classifier-spike-results.json`, no secrets, card/section text truncated to 300 chars each).

**Local rules:** don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry in the report); never touch `.env*`, `.claude/`; only stop processes you started (save `$!`), never pkill/killall; run `pnpm install --frozen-lockfile --prefer-offline` first (then a normal `pnpm install` for the version bump); biome via `rtk proxy pnpm exec biome check <files>`. If a step doesn't fit the real code (e.g. the classifier API differs from the plan), stop that item, report file:line / the real API, and continue.

Final report: Phase 0 results (what broke, the patch decision), harness design, the Phase 2 report path, spend, deviations, 5-line log entry.
