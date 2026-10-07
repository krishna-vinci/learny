# M4-7a — Today page, ⌘K search palette, reader selection menu + highlights (web only)

You are the frontend IMPLEMENTER for Studium (GPT-6.1 Sol via Codex; do not load orchestration skills or spawn sub-agents). You work in the worktree `/path/to/studium-worktrees/m4-7` (branch `codex/m4-7`). Use absolute paths or `cd` into it for every command, and never edit `/path/to/studium` itself.
- Only change `web/`. Don't commit. Don't edit `AGENT_MEMORY.md`: put your log entry in the report.
- Never pkill or killall; stop only the server PID you started.
- Read `AGENT_MEMORY.md` (in the worktree) and `docs/plans/2026-09-30-m4-study-loop.md` (M4-7 and the Decisions table).
- Use the `ui-ux-pro-max` skill. Build with the existing kit in `web/src/components/ui/*` (button, dialog, dropdown-menu, input, label, separator, switch, tooltip, scroll-area). The shadcn migration is deferred to M6, so no `npx shadcn` and no new dependencies.
- Follow the existing page styles (`SetHomePage.tsx`, `SetsPage.tsx`, the Settings sections) and the themes (tokens only, no hard-coded colours).

## APIs (already on main; read the server code for exact shapes)
- **Today:** `GET /api/today` → `TodayView {sets: TodaySet[], doNext: TodayItem[]}`. Types are in `shared/src/api.ts` (search `TodayView`); built by `server/src/today/build.ts`. Each `TodayItem` has `{kind, set, title, detail, href}`.
- **Search:** `GET /api/search?q=&set=&kind=&limit=` → `{results:[{kind:"note"|"source"|"card"|"chat", set, path, title, snippet, score}]}`.
  - `path` is root-relative: notes `<set>/notes/NN-x.md`, sources `library/<id>/…`, cards `<set>/cards/NN-x.md#c-xxxx`, chats a session id.
  - `snippet` marks matches with `[[` and `]]`; render them as `<mark>`, escaping everything else, and never inject raw HTML.
  - Route logic: `server/src/routes/search.ts`.
- **Chat with a quote:** `POST /api/sets/:set/chats/:id/messages {text, anchor?, quote?}`, where `quote` ≤ 4000 chars.
- **Highlights:** `/api/sets/:set/highlights` (`server/src/routes/highlights.ts`; types `Highlight`, `HighlightColor`, `HighlightPatch` in `shared/src/api.ts`):
  - `GET ?note=notes/NN-x.md` → `{highlights}`
  - `POST {note, quote, prefix, suffix, color, comment?}` → 201
  - `PATCH /:id {note, color?, comment?}`
  - `DELETE /:id?note=`
  - colours: yellow, green, blue, pink
  - The body key `note` is the NOTE PATH; the annotation is `comment`.

## Build

### 1. Today page `web/src/pages/TodayPage.tsx`, route `/today`
- Add the route in `web/src/router.tsx` (routes ~lines 72–96). Make it the landing page: `HomeRedirect` (router.tsx:43) sends `/` to `/today` when the user has ≥ 1 set; keep the zero-sets empty state and create-set flow as they are.
- **Layout (phone first):**
  - a "Do next" list of up to 7 tappable cards (icon by kind, title, detail, a chevron) that navigate to `href`
  - then "Your sets": one compact card per set, showing:
    - title
    - deadline chip: days left, overdue in destructive colour
    - small counts: chapters to review, draft cards, stale cards, running jobs
    - "Last studied X ago"
    - "Next: <chapter>"
  - tapping a set card goes to `/s/<set>`
- Refresh via TanStack Query; invalidate on SSE job/commit events like other queries (see `web/src/api/queries.ts` ~line 480).
- Add a **Today** row at the top of the sidebar nav (`web/src/components/AppSidebar/AppSidebar.tsx`, the SidebarRow list near line 179 "All study sets"), with lucide icon `SunIcon` or `CalendarCheckIcon`.

### 2. ⌘K search palette `web/src/components/Search/SearchPalette.tsx`
- Opens with Ctrl/⌘+K anywhere except while typing in the note editor. On the phone there's a search icon button in `MobileAppHeader` (AppSidebar.tsx) next to the activity indicator; on desktop, a "Search" row or button in the sidebar header.
- Build it as a dialog (desktop centred) or full-screen sheet (phone) on the kit's dialog, portalled to `<body>`:
  - input with 200 ms debounce
  - filter chips: All, Notes, Sources, Cards, Chats; optionally "This set"
  - results grouped by kind with title plus the highlighted snippet
  - keyboard: ↑/↓/Enter/Esc; real buttons for touch
- **Navigation:**
  - note → `/s/<set>/n/<file>`, scrolling to the first occurrence of the matched term (pass it as `?q=` and let the reader scroll to and briefly flash the first text match)
  - card → `/s/<set>/cards/<file>`, focusing the card id if the card page supports a hash; otherwise just the file
  - source → `/library/<id>`
  - chat → open the chat dock on that chat (`openChatDock()` in `web/src/components/ChatDock/openChatDock.ts`, plus selecting the chat; add a small event payload if needed)
- Empty state: recent searches (localStorage in try/catch) and tips.

### 3. Reader selection menu + highlights
Reader: `web/src/components/Reader/Reader.tsx` (the article ~line 288, `MarkdownView` ~line 337).

**Menu.** Selecting text inside the article (mouseup/touchend plus `selectionchange`, debounced) shows a small floating toolbar above the selection. On phone, show it as a bottom bar instead, so the native selection handles stay usable. Actions:
- **Ask:** open the chat dock and send the learner-typed question with `quote` = the selection and `anchor` = the note. Add a `quote` param to `api.chats.sendMessage` (`web/src/api/client.ts:513`) and to `useChatDock` (`web/src/components/ChatDock/useChatDock.ts:74-123`). The UX is a small prompt input prefilled with nothing, plus quick chips "Explain this", "Give an example", "Why?".
- **Explain simpler:** sends "Explain this passage more simply, for my level." with the quote.
- **Make a card:** sends "Make a card from this passage" as a chat message with the quote. The tutor can propose a cards job.
- **Highlight:** colour picker with 4 colours.

Hide the menu on scroll, Escape, or a click elsewhere.

**Highlights.**
- Fetch them per note. Render them by locating `quote` in the rendered article text: match with `prefix`/`suffix` for disambiguation; wrap the matched text nodes in `<mark data-highlight-id>` with the colour classes (theme tokens; readable in all 5 themes).
- A highlight that can't be located goes in an "Unplaced highlights" list instead of being dropped.
- Tapping a highlight opens a small popover to change the colour, add or edit a comment, or delete it.
- A "Highlights (n)" button in the note toolbar opens a list (sheet on phone, popover or side panel on desktop) that jumps to each one.
- Don't break KaTeX, code blocks or mermaid: never wrap across those elements, and skip selections inside them for highlighting (Ask still works).
- Highlights must survive a theme change and a re-render.

## Verify (required)
- Test server:
  1. `mkdir -p /tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/m4-test/a` and copy `/path/to/studium/examples/sample-set` there as `legacy`.
  2. Start with `STUDIUM_DATA_DIR=<dir>/data STUDIUM_STUDY_ROOT=<dir>/legacy HOST=127.0.0.1 PORT=3150 STUDIUM_FAUX=1` from `server/`.
  3. `/setup`, then RESTART the server once (the legacy tree migrates only at boot after the admin exists; see AGENT_MEMORY).
- Puppeteer-core is in `/tmp/claude-1000/-home-krishna-learny/a7d2a3ad-46a1-478a-baa0-09617d6e3f49/scratchpad/shot/node_modules`, Chrome at `/usr/bin/google-chrome`.
  - Use REAL `elementHandle.click()`/`tap()` with `waitForNavigation`; see the `stableGoto` helper in that dir.
  - Viewports: 390×844 (isMobile/hasTouch) and 1440×900. Test Light and Dark.
- Scenarios:
  - Today loads as the landing page, and "Do next" navigates.
  - ⌘K search for a phrase in `03-svd.md` opens the note scrolled to the match; card and source results navigate.
  - Select text → Ask sends a message with the quote (check the request body via page request interception).
  - Highlight → the mark renders, persists after reload, a comment can be edited and it can be deleted.
  - Highlights inside KaTeX are refused gracefully.
- Checks: `pnpm --filter @studium/web exec tsc --noEmit`, `rtk proxy pnpm exec biome check <changed files>`, vitest for new pure helpers (add tests for snippet rendering and highlight text-location), and `pnpm --filter @studium/web build`. Stop your server.

If something doesn't fit the real code, stop and report the mismatch (file:line, what you saw).

## Report
1. Changed files.
2. Checks.
3. Flows verified.
4. Screenshot paths (phone and desktop, light and dark).
5. Anything not done.
6. A 5-line log entry.
