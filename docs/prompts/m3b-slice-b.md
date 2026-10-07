# M3b Slice B — Reading comfort (web only)

Slice A is committed and merged. Continue in the same worktree (`/path/to/studium-worktrees/m3b`, branch `codex/m3b`) and implement **Slice B** (B1–B3) of `docs/plans/2026-09-30-m3b-comfort.md` exactly. Re-read the plan's Global constraints. Use the `ui-ux-pro-max` skill for the design.

## Context
- The note toolbar (Edit / Make cards / History) is in `web/src/components/Reader/Reader.tsx`. The article body renders through `web/src/components/Reader/MarkdownView.tsx` (`.studium-prose`); the prose styles are in `web/src/index.css`.
- Layout: `web/src/layouts/RootLayout.tsx` holds the sidebar (+ collapse), the chat dock (`web/src/components/ChatDock/*`, including the phone chat button) and the mobile header (`MobileAppHeader` in `web/src/components/AppSidebar/AppSidebar.tsx`).
- Persisted-preference pattern with try/catch: see `web/src/components/ChatDock/useChatDockCollapsed.ts`. Put reading preferences in one small store, e.g. `web/src/lib/reading-prefs.ts`, with a unit test. Slice C will add theme/accent to the same store, so design it to extend.
- Popovers and sheets: reuse `web/src/components/ui/*`. Sheets opened from the phone drawer portal to `<body>`. base-ui menu items use `onClick`.

## Must-haves
- **B1:**
  - Text size in 5 steps: 15, 16, 17, 19, 21 px.
  - Width: 60, 72 or 90ch.
  - Typeface: sans or a system serif stack.
  - Line spacing: 1.5, 1.7 or 1.9.
  - Reset button.
  - A live preview in the Aa popover/sheet.
  - KaTeX, code (0.9 ratio) and tables scale with the text.
  - Defaults are unchanged from today's look.
- **B2:** full screen, as the plan describes:
  - the Fullscreen API where it exists, with the iOS CSS fallback
  - hides the sidebar, the chat dock and chat button, and the mobile header
  - a floating Exit button, plus Esc and `f` on desktop
  - keeps the screen awake with a wake lock, released on exit or when the tab is hidden
- **B3:** scroll position per note in sessionStorage.

## Verify
- Test server:
  1. `mkdir -p /tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m3b-test/b` and copy `examples/sample-set` there as `legacy`.
  2. Run with `STUDIUM_DATA_DIR=<that>/data STUDIUM_STUDY_ROOT=<that>/legacy HOST=127.0.0.1 PORT=3141 STUDIUM_FAUX=1`.
  3. First visit `/setup`. Don't `rm -rf` computed paths.
- Puppeteer, with REAL clicks, at 390×844 (isMobile/hasTouch) and 1440×900, on a note with maths and code (e.g. `linear-algebra/notes/03-svd.md`):
  - change each setting; maths and code scale; the settings persist after a reload
  - full screen enters and exits on both sizes
  - scroll down, open another note, come back: the position is restored
- Screenshots:
  - phone, default vs largest text + serif + wide
  - the Aa sheet
  - phone full screen
  - desktop full screen
- Checks: `pnpm --filter @studium/web exec tsc --noEmit`, `rtk proxy pnpm exec biome check <changed files>`, vitest for the new store plus files near your changes, and `pnpm --filter @studium/web build`. Stop the server.

If something doesn't fit the real code, stop and report the mismatch (file:line, what you saw). Web only; don't commit. Final report: changed files, tests with results, screenshot paths, anything not done.
