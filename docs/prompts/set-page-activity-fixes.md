# Set page, activity panel, accept from course plan, per-set sources (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/set-page` on branch `codex/set-page`. Do not load orchestration skills and do not spawn sub-agents.

**Local rules:** don't commit/push/branch; never edit `AGENT_MEMORY.md` (log entry in the report); never touch `.env*`, `data/`, `.claude/`; test servers on temp copies of `examples/sample-set` on your own port (admin from env, `STUDIUM_FAUX=1`); only stop processes you started (save `$!`), never pkill/killall; run `pnpm install --frozen-lockfile --prefer-offline` first; biome via `rtk proxy pnpm exec biome check <files>`; base-ui `Menu.Item` uses `onClick`; use real clicks in browser checks. Line numbers below may have drifted: if a step doesn't fit the real code, stop that item, report file:line, and continue with the rest.

Final report: changed files, tests with pass/fail counts, browser-check results (390×844 and 1440×900, light and dark), deviations, 5-line log entry.

---

Task: Fix several set-page and activity-panel issues in the Studium web app (web/ is React 19 + Vite + Tailwind 4, shadcn-style components in web/src/components/ui; server/ is Hono). Follow AGENTS.md in the repo root: no commits, no drive-by refactors, match surrounding style, keep the diff reviewable.

## Part 1 — Activity panel goes off-screen (bug)
DesktopActivityIndicator (web/src/components/ActivityIndicator.tsx) is a popover anchored `absolute end-0 top-full mt-2 w-[22rem]` (lines 148–155) with NO portal. It's mounted in AppSidebar.tsx:381 (expanded sidebar, fine) and RootLayout.tsx:40 inside CollapsedSidebarRail (RootLayout.tsx:36–52, a ~40px fixed left rail). When the sidebar is collapsed, `end-0` pushes the panel ~70–85% off-screen so logs/errors are unreadable. The mobile sheet (MobileActivityIndicator, lines 90–125) already portals to document.body correctly.
1. Portal the desktop panel to document.body and position it with fixed coordinates from the trigger's bounding rect (flip/clamp to stay fully in-viewport), or anchor it to open rightward from the rail — whichever keeps the current look next to the expanded sidebar AND works next to the collapsed rail. Preserve outside-click/Escape closing and useCloseActivityPanelOnNavigate (ActivityIndicator.tsx:63–69).
2. Job errors are clamped to 2 lines (ActivityPanelContent.tsx:94–98) with full text only in a tooltip. Make failed rows expandable so the full error text is readable (break-words). Keep the "View all jobs" footer link.
3. Don't touch the jobs data layer, SSE (web/src/api/events.ts), toasts, or the /jobs page.

## Part 2 — Set page layout restructure (web/src/pages/SetHomePage.tsx)
Current top-to-bottom order (lines 230–379): title/goal header → "Next step" ContinueCard (263–272) → running-jobs line → CoursePlan (282) → toolbar: Add source / New chapter / Practice / Ask the tutor (284–321) → "More actions" collapsible containing "Write a note" (NewNoteDialog), "Make a plan" (PlanSetSheet), and BookCard with build/download (323–337) → Notes list (339–355).
Required new order, top to bottom:
1. Title + goal header (unchanged); keep the running-jobs line under it.
2. Primary toolbar ABOVE the course plan: Add source, New chapter, Ask the tutor, Write a note, Make a plan. Promote the two actions hidden in "More actions" into this toolbar and REMOVE the "More actions" toggle entirely. This also fixes the book build/download being invisible until "More actions" is clicked.
3. Notes section (NoteRow list + DraftingRow placeholders) directly below the toolbar, above the course plan.
4. Book card (Build book PDF / Rebuild + Download) below the notes section.
5. CoursePlan below that.
6. "Next step" (ContinueCard) at the BOTTOM, below the course plan. Exception: while a plan-set job is running, keep PreparingCard near the top since nothing else is actionable.
All dialogs/sheets and state wiring (lines 357–376) keep working — placement only, no server changes. Verify the toolbar wraps (not overflows) at 390px and looks right at 1440px.

## Part 3 — Accept draft from the course plan
Accept currently exists only on the Inbox page (web/src/pages/InboxPage.tsx:92–193 → api.inbox.accept → POST /api/sets/:set/notes/accept, server/src/routes/inbox.ts:227–268; requires note status ∈ {draft, checked} else 409). CoursePlan (web/src/components/CoursePlan.tsx:51–245, states in STATE_LABELS line 49) has no accept.
1. For chapters in state drafted or checked with a note path, render an "Accept" button: state "checked" → single-click accept; state "drafted" → confirm first ("Accept anyway") via the existing ConfirmDialog, mirroring InboxPage semantics.
2. On success invalidate queryKeys.course(set), queryKeys.notes(set), queryKeys.inbox(set); on 409 show the server error. Hide/disable Accept while that chapter's draft job is running (state drafting).
3. Server: buildCourse (server/src/course/build.ts:54) maps both checked and accepted → "checked". Extend it to report state "accepted" (update the course view type in shared/src accordingly), and add an "accepted" badge to STATE_LABELS, same family as checked but visually stronger.

## Part 4 — Sources from other sets mixing in
A set's sources live in PLAN.md frontmatter `sources: [lib-…]` (written in server/src/jobs/ingest-job.ts:229–247; reverse map setsBySourceId in server/src/ingest/library.ts:284–310), but every UI uses the global GET /api/library: SourcePicker (web/src/components/SourcePicker.tsx:13, used by "New chapter"/plan flows) lists ALL sources, and LibraryPage shows all with `source.sets` as plain text (LibraryPage.tsx:132).
1. Add GET /api/sets/:set/sources returning only that set's sources: read its PLAN.md frontmatter `sources` and resolve to SourceSummary via summaryFrom (server/src/ingest/library.ts:312–328). Follow existing route patterns in server/src/routes/sets.ts (isSetSlug/setExists, 404 unknown set) and add the client method in web/src/api/client.ts.
2. SourcePicker on a set page: default to the set's own sources (pre-checked), with the full library under a separated "All sources" browse/search mode so any source can still be linked to this set. Keep the existing api.jobs.create({ sources: [...] }) contract.
3. LibraryPage: add a per-set filter (dropdown/chips) filtering by source.sets; default "all". Don't change ingest or the "Add source" flow.

## Tests & verification (per AGENTS.md policy — scoped, not the full suite)
- pnpm --filter @studium/server exec vitest run src/course/ (accepted state) and the test files covering the new /sources endpoint and any changed route/util files
- pnpm --filter @studium/web exec vitest run <test paths you added/extended next to ActivityIndicator, CoursePlan, SetHomePage, SourcePicker>
- pnpm exec biome check <changed files>
- tsc --noEmit for @studium/server, @studium/web, @studium/shared (shared types changed)
- Manually verify the set page and activity panel at 390px and 1440px.

## Acceptance
- Collapsed sidebar: the whole activity panel, including full failed-job error text, is visible in-viewport.
- Set page reads: header → toolbar → notes → book build/download → course plan → next step; "More actions" is gone; book build/download visible without extra clicks.
- Checked chapter accepts in one click from the course plan; drafted chapter asks for confirmation; accepted chapters show an accepted badge; Inbox unchanged.
- "New chapter" on a set shows that set's sources by default, others only under "All sources"; Library page filterable by set.
