# M3b Slice C — Themes (web only)

You are the frontend implementer for Studium. You work in the worktree `/home/krishna/learny-worktrees/m3b` (branch `codex/m3b`, deps installed). Use absolute paths or `cd` into it for every command, and never edit `/home/krishna/learny` itself.
- Only change `web/`. Never touch `server/`, `shared/`, `data/`, `.env*` or `.claude/`. Don't commit.
- Read `/home/krishna/learny/AGENT_MEMORY.md` first (gotchas!) and `docs/plans/2026-09-30-m3b-comfort.md` (Slice C, C1–C4).
- Use the `ui-ux-pro-max` skill for the palettes and contrast. Load it with the Skill tool, or read `/home/krishna/.agents/skills/ui-ux-pro-max/SKILL.md`.
- This is a persistent session: later M3b/M4 frontend work will come to you as follow-up messages.

## Exact targets

1. **`web/src/index.css`** (348 lines). Today:
   - `:root` light tokens: lines 4–48
   - dark tokens inside `@media (prefers-color-scheme: dark) { :root {...} }`: lines 50–83
   - `@theme inline` mapping: line 85

   Tokens to define per theme: background, foreground, card(+fg), popover(+fg), primary(+fg), secondary(+fg), muted(+fg), accent(+fg), destructive(+fg), success(+fg), warning(+fg), border, input, ring, overlay, sidebar, sidebar-foreground, sidebar-accent(+fg), shadow-float.

   Restructure:
   - light stays on `:root`
   - move today's dark values unchanged into `:root[data-theme="dark"]`
   - add `:root[data-theme="sepia"]` (warm paper bg around `oklch(0.95 0.03 85)`, brown-grey text) and `:root[data-theme="black"]` (`#000` bg, dimmed borders)
   - "system": `@media (prefers-color-scheme: dark) { :root[data-theme="system"], :root:not([data-theme]) { …dark tokens… } }`. Avoid duplicating the dark token list twice if you can (e.g. one shared block with both selectors).
   - Body text must pass WCAG AA in every theme.
2. **Accents:** `data-accent` on `<html>` = `blue` (default; today's primary `oklch(0.45 0.08 250)` light / `oklch(0.66 0.11 250)` dark) | `teal` | `green` | `amber` | `rose` | `violet`. Each overrides `--primary`, `--primary-foreground`, `--ring` (and link colour if separate) with light and dark-family variants; dark, black and sepia pick the right lightness.
3. **Code highlighting.** `web/src/components/Reader/MarkdownView.tsx:6` imports `highlight.js/styles/github.css`, which is light-only, so code is wrong in dark today. Remove that import and define the `.hljs-*` token colours in `index.css` through CSS variables (`--code-bg`, `--code-fg`, `--code-keyword`, `--code-string`, `--code-comment`, `--code-number`, `--code-title`, `--code-attr`, …) set per theme. Cover the classes github.css styled.
4. **Mermaid:** `web/src/components/Reader/MermaidBlock.tsx:42-48` calls `mermaid.initialize({ theme: "default" })`. Pick `"dark"` for dark and black, `"neutral"` for sepia, and `"default"` for light, based on the *resolved* theme, and re-render when the theme changes.
5. **Preference store:** extend `web/src/lib/reading-prefs.ts` (key `studium.reading-prefs`; `DEFAULT_READING_PREFS` at line 30; `setReadingPrefs`/`useReadingPrefs`/`getReadingPrefs`; unknown keys are already preserved by design).
   - Add `theme: "system"|"light"|"dark"|"sepia"|"black"` (default `system`) and `accent` (default `blue`), validated per field like the others.
   - Add `resolvedTheme()` (system → light/dark via `matchMedia`) and a `useResolvedTheme()` hook that reacts to both the preference and OS changes.
   - Extend `web/src/lib/reading-prefs.test.ts`.
6. **Apply to the DOM:** a small `web/src/lib/theme.ts` (or inside reading-prefs):
   - set `document.documentElement.dataset.theme`/`.accent` on change
   - update `<meta name="theme-color">` (currently hard-coded `#2b4a6f` in `web/index.html:6`) to the resolved background colour
   - mount it once, e.g. from `web/src/main.tsx` or `web/src/layouts/RootLayout.tsx`
7. **No flash:** in `web/index.html`, add a tiny inline `<script>` in `<head>` (before CSS) that reads `localStorage["studium.reading-prefs"]` inside try/catch and sets `data-theme` and `data-accent` before first paint. Keep it CSP-simple; no imports.
8. **Settings → Appearance:** add `{ key: "appearance", scope: "basic", label: "Appearance", icon: PaletteIcon (lucide), component: AppearanceSection }` in `web/src/components/Settings/settingSections.ts:56-67`, placed right after "My account". The new `web/src/components/Settings/AppearanceSection.tsx` has:
   - theme cards: 5 swatches, each previewing bg, text and accent
   - accent swatches: 6
   - the reading defaults, reusing controls from `web/src/components/Reader/ReadingSettings.tsx` (301 lines; extract the shared segmented controls instead of duplicating them)

   Follow the existing section style (`SettingSection`/`SettingGroup`/`SettingRow` in `web/src/components/Settings/`).
9. **Quick toggle:** in `UserFooter` (`web/src/components/AppSidebar/AppSidebar.tsx:230`), add an icon button that cycles System → Light → Dark, with a tooltip and aria-label showing the current mode. It shows in both the desktop sidebar and the phone drawer.

## Rules
- base-ui menu items use `onClick`, not `onSelect`.
- Sheets opened from the phone drawer portal to `<body>`.
- localStorage access goes in try/catch with working defaults.
- No new dependencies.

## Verify (required)
- Test server:
  1. `mkdir -p /tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m3b-test/c` and copy `/home/krishna/learny/examples/sample-set` there as `legacy`.
  2. From `server/` run `STUDIUM_DATA_DIR=<dir>/data STUDIUM_STUDY_ROOT=<dir>/legacy HOST=127.0.0.1 PORT=3142 STUDIUM_FAUX=1 pnpm exec tsx src/main.ts` in the background.
  3. First visit `/setup`.
  4. Add a python code block to your test copy of a note if it has none. Never `rm -rf` computed paths.
- Puppeteer-core is in `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/shot/node_modules`; Chrome is `/usr/bin/google-chrome`; put scripts in that `shot/` dir. Use REAL clicks (`elementHandle.click()`/`tap()`) at 390×844 (isMobile, hasTouch) and 1440×900, and wait with `domcontentloaded` plus a timeout.
- Check:
  - every theme × {set home, a note with maths, code and mermaid, Settings → Appearance, the sign-in page}
  - accents change the primary buttons and links
  - the quick toggle cycles
  - a reload keeps the choice with no flash (screenshot immediately after `domcontentloaded`)
  - `meta[name=theme-color]` changes
  - "system" follows `page.emulateMediaFeatures([{name:"prefers-color-scheme",value:"dark"}])`
- Screenshots: one note in all 5 themes (phone), the Appearance section (phone and desktop), and a code block plus mermaid in dark.
- Checks: `pnpm --filter @studium/web exec tsc --noEmit`, `rtk proxy pnpm exec biome check <changed files>` (use `rtk proxy`), vitest for `reading-prefs.test.ts` plus files near your changes, and `pnpm --filter @studium/web build`. Stop your server.

If something doesn't fit the real code, stop and report the mismatch (file:line, what you saw).

## Final report
1. Changed files, one line each.
2. Checks with results.
3. Flows verified.
4. Screenshot paths.
5. Anything not done.
6. A 5-line log entry (date, task, files, learnings, open items) that the orchestrator will add to AGENT_MEMORY.md.
