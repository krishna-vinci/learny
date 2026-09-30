# M5-B — Practice: web (local, GPT-6.1 Sol, same session as M5-A)

The server part is reviewed. Continue in `/home/krishna/learny-worktrees/m5` and implement **"PR B: web"** of `docs/plans/2026-10-01-m5-practice.md` exactly. Read the M5-B section of the plan again.

**Local rules:** the same as M5-A (no commits/PRs/branches, no `AGENT_MEMORY.md` edits, never pkill). Use the `ui-ux-pro-max` skill for the design.

**Browser verification is required.** Use the plan's recipe:
- `T=/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m5-test`. Make it with `mkdir -p`; never `rm -rf` computed paths.
- Admin from env at first boot: `HASH=$(printf 'testpass123\n' | pnpm --filter @studium/server --silent hash-password)`, `STUDIUM_USERNAME=admin`, `PORT=3170`, `STUDIUM_FAUX=1`.
- puppeteer-core is in `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/shot/node_modules`, Chrome at `/usr/bin/google-chrome`. Use real `elementHandle.click()`/`tap()` with `waitForNavigation` (see the `stableGoto` helper in that dir).
- Seed quiz, problem and grade files for the flows the faux model can't produce.
- Viewports 390×844 and 1440×900; Light, Dark and Sepia.

Report: changed files, checks, flows verified, screenshot paths, deviations, log entry.
