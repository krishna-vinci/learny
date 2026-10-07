# Task: M3b Slice A — background jobs UX (web only)

You are the IMPLEMENTER in /path/to/studium-worktrees/m3b on branch codex/m3b. A previous agent already wrote most of Slice A here; `git status` and `git diff` show it (new: `web/src/components/Activity/`, `web/src/lib/job-transitions.ts` + test). Review it against A1–A6 and finish it; do not start over. Do not load orchestrator or workflow skills and do not spawn sub-agents. You MUST use the `ui-ux-pro-max` skill (in your skills list; source `/home/<username>/.agents/skills/ui-ux-pro-max/SKILL.md`) for design decisions.

## Goal
Implement **Slice A** of `docs/plans/2026-09-30-m3b-comfort.md` (A1–A6) exactly. Read the whole plan first: Global constraints apply. Later slices (B, C) come in follow-up messages in this same session. Do only A now.

## Context
- Web stack: React 19, Vite, Tailwind 4, TanStack Query (`web/src/api/queries.ts`; SSE job events handled around line 480), react-router (`web/src/router.tsx`), base-ui primitives in `web/src/components/ui/*` (menu items use `onClick`, never `onSelect`), toasts via `react-hot-toast`.
- The job start points to change:
  - `web/src/components/NewChapterSheet.tsx:52` (`navigate("/jobs")`)
  - the Make cards button in `web/src/components/Reader/Reader.tsx`
  - Add source in `web/src/components/Library/AddSourceSheet.tsx`
  - the chat proposal Run in `web/src/components/ChatDock/*`
- Layout: `web/src/layouts/RootLayout.tsx`; the mobile header and sidebar are in `web/src/components/AppSidebar/AppSidebar.tsx` (`MobileAppHeader`, `AppSidebar`); the notes list is in `NotesSection` there and in `web/src/pages/SetHomePage.tsx`.
- Types: `JobView`/`JobResult` in `shared/src/api.ts:86-110`. Cancel: `POST /api/jobs/:id/cancel`. Existing job formatting helpers: `web/src/lib/job-format.ts`.
- Sheets opened from inside the phone drawer must portal to `<body>` (see `web/src/components/NewChapterSheet.tsx` for the pattern).

## Scope
- Change: `web/` only.
- Do not touch: `server/`, `shared/`, `data/`, `.env*`. If you need a server change, stop and report.

## Verify (required)
1. `pnpm --filter @studium/web build`.
2. Run a test server:
   ```
   T=$(mktemp -d); cp -r /path/to/studium/examples/sample-set $T/legacy
   cd /path/to/studium-worktrees/m3b/server
   STUDIUM_DATA_DIR=$T/data STUDIUM_STUDY_ROOT=$T/legacy HOST=127.0.0.1 PORT=3130 STUDIUM_FAUX=1 pnpm exec tsx src/main.ts &
   ```
   First visit → `/setup` creates an admin. Also set the drafter model to the faux model if drafts need it: check Settings → Models, or `_global/config.yaml` in `$T/data/users/<admin>`.
3. Drive it with puppeteer-core (installed at `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/shot/node_modules`; Chrome is `/usr/bin/google-chrome`; put scripts in that `shot/` dir) at 390×844 (isMobile/hasTouch) and 1440×900. Use REAL clicks (`elementHandle.click()`/`tap()`), wait with `domcontentloaded` plus a timeout, and look at the screenshots.
4. The plan's "Verify A" scenario:
   - Two drafts started back to back.
   - Both placeholders show and the indicator shows the count.
   - You stay on the page and can open another note.
   - The completion toast's Open lands on the new note.
   - Cancel works from the panel.
5. Stop the server.

## Checks
- `pnpm --filter @studium/web exec tsc --noEmit`
- `rtk proxy pnpm exec biome check <changed files>`
- Web vitest files near your changes, plus a unit test for the job-transition detector (A4).
- The build.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
Follow /path/to/studium/AGENTS.md. Do not commit. End with the AGENTS.md final report plus screenshot paths.

Test-server hygiene: put test data under `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m3b-test/` and never `rm -rf` computed paths. If `apply_patch` fails, write the file with a shell heredoc.
