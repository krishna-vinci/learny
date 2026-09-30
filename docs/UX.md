# UX audit and simplification plan (M6)

Written 2026-10-01 for M6, "Simple, calm and polished". Acceptance bar (owner): *"It should feel
natively simple and intuitive to use. The user should not sense any annoyance and should not get
confused by features."* Sections 3–6 of `docs/plans/2026-10-01-m6-simple-and-polished.md` implement the
changes listed here. This document is the contract they work to.

Method: two walkthroughs on a phone (390×844, touch) against a running build of `main`
(d25d8ce), plus a code scan for jargon, confirms, toasts and dead ends.

- **First-timer:** a brand-new empty instance, `/setup` → first set → set home → add source → first
  chapter → chat → Today. Cards, practice and book were reached on the populated sample instance because the
  fake model cannot finish AI jobs.
- **Returning learner:** populated sample instance: open → Today → set home → note → cards → To review
  (Inbox) → Library → Jobs → Settings → set drawer.
- Practice (M5) does not exist on `main` yet. See "Practice" below.

Screenshots referenced as `fp-NN` (first-timer) and `rl-name` (returning) were captured during the
audit and are described inline; the PR for this document describes them.

## 1. Findings, ranked

Severity: **S1** blocks or misleads a beginner · **S2** causes hesitation or annoyance ·
**S3** polish. Frequency: how often a normal session hits it.

### Top 10 (fix or explicitly defer; re-checked in section 8)

| # | Sev | Finding | Where | Fix (section) |
|---|---|---|---|---|
| F1 | S1 | **A new user lands on a blank "Create your first study set" page with two inputs to a long form.** They are not asked what they want to learn, and the powerful path (agent plan) is hidden behind a checkbox. After the set exists they see five equal action cards and an empty "how it works" list. There is no single next step. | `fp-03`, `fp-07`, `router.tsx` `HomeRedirect` | First-run flow (4), Continue page (3) |
| F2 | S1 | **Phone navigation is a hamburger drawer.** Main destinations (Today, Library, Cards, Inbox, Jobs, Settings) are two taps away and the drawer contains disabled rows ("Inbox", "Cards" greyed) when there is no set. The top bar says "Select a set" on Today/Sets/Library, which reads like an unfinished form. | `fp-04`, `rl-today` | Bottom tab bar (3) |
| F3 | S1 | **Jargon and internal names in the UI:** Inbox (it holds chapters, plans and later cards to review), Jobs, "draft-chapter", "Ingest failed", parse tier, "Cardsmith / Critic / Outliner / Drafter / Checker" in Settings, "critic: ok" on cards, "0 stale card files". | `ModelsSection.tsx`, `AddSourceSheet.tsx`, `CardFilePage.tsx`, Today counts | Renames (3), glossary below |
| F4 | S1 | **Raw server/agent errors shown to people:** `"Vectors" failed: drafter must create exactly notes/01-vectors.md`; `Site mapping requires Firecrawl. Configure FIRECRAWL_API_URL.`; pandoc binary missing. There is no plain sentence and no fix action. | `fp-10`, `DocsSiteTab`, Book card | Friendly errors (4) |
| F5 | S2 | **Floating chat button covers bottom bars and content** on every phone screen (Inbox review bar, Approve buttons, last list rows, note text). Fixed once ad hoc for the plan review only. | `rl-note`, `fp-07` | Chat lives in set context, never over bars (3) |
| F6 | S2 | **Too many equal choices on Set home:** New chapter, Write a note, Add source, Plan with agent, Ask tutor, Book, plus a how-it-works list; an orphaned fifth card on phones. Nothing says which is next. | `fp-07`, `rl-set-home` | "Continue" page with one primary action (3) |
| F7 | S2 | **Toast noise:** a "Drafting …" success toast and a failure toast stack over the header at the same time; success toasts last 8 s and repeat for results already visible (book built, plan approved); the notifications nudge is triggered by count, not by need. 107 toast call sites. | `fp-10`, `JobToasts.tsx` | Notification hygiene (5) |
| F8 | S2 | **Native `confirm()` dialogs** for revert, discard changes and "accept anyway", and confirm-before-act for reversible actions (discard plan). Native dialogs look foreign on a phone and cannot be styled. | `NoteHistory.tsx:72`, `Reader.tsx:52`, `InboxPage.tsx:125` | Undo over confirm, one dialog component (5) |
| F9 | S2 | **Overlays do not behave like overlays:** Escape does not close Add source, New chapter, New set or the plan sheet (hand-rolled `createPortal`s), focus is not trapped, so pointer events go to the wrong layer. | `AddSourceSheet`, `NewSetDialog`, `NewChapterSheet`, `PlanSetSheet` | Move to one Dialog/Sheet primitive (2, 5) |
| F10 | S2 | **Dead-end and confusing empty states:** Cards says "No card files yet. Open a note and use “Make cards”" (a path, not a button); Inbox says "Nothing awaiting review." with a "New chapter" button; Jobs page is blank when empty; Today says "You're caught up. Open a set to keep learning." for a set with nothing in it; set goal shows "(not set yet)". | `rl-cards`, `rl-inbox`, `rl-jobs`, `fp-06b`, `fp-07` | Empty states teach (4) |

### Other findings

S2
- **Today shows machine counters** ("0 chapters to review · 0 draft cards · 0 stale card files · 0 running
  jobs") even when all are zero. Zeros are noise. Show only what needs attention. (3)
- **Two entry points for the same thing:** "Add source" is in the drawer, Set home, Library, Inbox has "New
  chapter", the notes list has "Add note", the set switcher has "New study set", Sets page has "New study
  set", and the empty home has another. (3)
- **Note toolbar is a row of unlabeled-weight buttons** (Edit, Make cards, History, Highlights (0), Aa,
  fullscreen) that wrap to two lines on a phone and all look equally important. Reading should be the
  primary action; the rest belong in a "⋯" menu. (3, 5)
- **Settings is a 14-item list on a phone** (My account, Appearance, Sessions, Access tokens,
  Notifications, Data, Models, Services, Members, Instance, SSO, Backups, General) with admin-only items
  mixed with personal ones. Group into Personal / Learning / Admin and hide admin items from non-admins. (3)
- **No feedback within 100 ms on several actions:** "Build book", "Start planning", card approve/reject and
  highlight changes wait for the server. (5)
- **Generic loading text** ("Loading…", "Finding your next step…") instead of skeletons, causing layout shift
  on Today, the note list and the reader. (5)
- **Activity panel vs Jobs page vs toasts:** three places report the same job. (3, 5)

S3
- Toast overlaps the top bar on phones. (5)
- Page titles and headings are inconsistent in weight and spacing (Today `text-lg`, Set home `text-xl`). (2)
- Level 1–5 has no names; the deadline input shows `mm/dd/yyyy` placeholder. (4)
- Theme toggle in the drawer and Appearance settings are two controls for one thing. (3)
- Hard-coded English relative times ("Last studied just now") and locale dates in several places. Acceptable
  (no i18n in M6) but keep in one helper. (5)
- `dangerouslySetInnerHTML` is used for Mermaid SVG and highlighted code. Both come from libraries that
  sanitise; keep and add a security note (7).

### What already works (keep)
Reader typography and width; themes and accents; the agent always proposes and the learner approves;
Today's single "Do next" card; the Library source list; the chat dock's quote-and-ask; real progress text in
the Activity panel.

### Nielsen's ten heuristics: summary

| Heuristic | Verdict | Main gaps |
|---|---|---|
| 1 Visibility of system status | Partial | Book/plan/planning progress fine; optimistic feedback missing; toasts duplicate visible results (F7) |
| 2 Match with the real world | Weak | Jargon (F3), "draft-chapter", tiers, role names |
| 3 User control and freedom | Weak | Native confirms instead of undo (F8); Escape does not close sheets (F9) |
| 4 Consistency and standards | Partial | Hand-rolled overlays vs shared Dialog; two button shapes; headings differ |
| 5 Error prevention | Partial | Disabled buttons without reason; typed confirm only where needed is fine |
| 6 Recognition over recall | Partial | Main destinations hidden in a drawer (F2) |
| 7 Flexibility and efficiency | Good | ⌘K search, keyboard in cards; add selection actions to a menu |
| 8 Aesthetic and minimalist design | Weak | Five equal cards, counters of zero, 14 settings (F6) |
| 9 Help users recover from errors | Weak | Raw errors (F4) |
| 10 Help and documentation | Weak | No onboarding; the "how it works" list disappears after the first note |

### Practice (M5)
Practice screens do not exist on `main` yet. When they land they must follow this document: a **Practice**
tab on phones; one primary action ("Start practice"); results shown as a short summary with "Practise weak
spots" as the next step; no jargon ("Examiner"/"Grader" never appear in UI copy); skeletons while a session is
prepared; friendly error if AI is off. M6 sections rebase on `main` and include Practice in the pass if it
has merged.

## 2. Information architecture

### Phone

Bottom tab bar, always visible (hidden only in immersive/full-screen reading and inside editors):

| Tab | Goes to | Notes |
|---|---|---|
| **Today** | `/today` | Default landing. "Do next" first. |
| **Notes** | `/s/:set` ("Continue" page) then the note list | The current set. With no set, it is the first-run flow. |
| **Practice** | `/s/:set/practice` (M5) until it exists: `/s/:set/cards` | Review cards and practise. |
| **Search** | opens ⌘K search full-screen | |
| **More** | sheet | Library · Cards · To review · Activity · Settings · switch set · New study set · theme · sign out |

Top bar: the current set name (tap to switch) on set screens; the page title elsewhere. Never the words
"Select a set". The chat button appears only inside a set, as a bottom-right button that sits above the tab
bar and any action bar (safe-area aware) and is hidden while a sticky action bar is on screen.

### Desktop

Sidebar in two groups plus a footer:

- **Study**: Today · (current set) Notes · Practice · Cards · To review
- **Library**: Sources · Add source
- Footer: Activity · Settings · account/theme; set switcher stays at the top.

### Screens and their one primary action

| Screen | Primary action |
|---|---|
| First run | Next (each step) |
| Today | The "Do next" card |
| Set home ("Continue") | The next best step for this set (from Today's do-next) |
| Note | Read; "Make cards" lives in the "⋯" menu unless the note has no cards yet |
| To review: list | Open the first item |
| To review: chapter / plan | Accept / Approve & draft first 3 |
| Cards file | Approve (keyboard `a`) |
| Library | Add source |
| Activity | none (status screen); Cancel per job |
| Settings | none |

## 3. Copy glossary (internal term → user word)

UI copy only; code identifiers, routes and API names do not change.

| Internal | User-facing |
|---|---|
| Inbox | To review |
| Jobs | Activity |
| job, background job | task (in sentences: "in the background") |
| draft-chapter | chapter |
| ingest / ingest failed | adding a source / "Couldn't add this source" |
| parse tier, tier A–D | source quality (Basic / Good / Best) |
| credibility | reliability |
| Cardsmith, Critic | "Writes flashcards", "Checks flashcards" |
| Outliner | "Plans your study set" |
| Drafter, Checker | "Writes chapters", "Fact-checks chapters" |
| Librarian | "Summarises sources" |
| Tutor | Tutor (keep: friendly) |
| study set | study set (keep); never "workspace" |
| curriculum | chapter list |
| stale card files | cards that need a refresh |
| draft cards | new cards to review |
| proposal | suggestion |
| plan-set / Plan with agent | Make a plan |
| compile-book / Build book | Make a PDF book |
| MCP, Firecrawl, MinerU | hidden behind "Services" with plain descriptions; shown only to admins |
| "agent" | "assistant" in headings; "the AI" in error sentences |

## 4. Interaction rules

1. **One primary action per screen.** Exactly one filled button; everything else is outline, quiet or in a
   "⋯"/More menu.
2. **Undo over confirm.** Reversible actions happen immediately and show an undo toast (8 s). Confirm
   dialogs only for irreversible ones (purge user, restore backup, delete data), with typed confirmation for
   the worst. No native `confirm()`.
3. **Feedback within 100 ms.** Every tap changes something visible immediately (optimistic update, pressed
   state, or skeleton). Never a dead button.
4. **No modal stacks.** A sheet or dialog never opens another. Multi-step things are steps inside one sheet.
5. **Toasts are rare.** Only for results not visible on screen and for failures. Success toasts hide after
   3 s; failures stay with an action. Merge repeats ("3 chapters started").
6. **Nothing nags.** At most one first-use hint at a time, shown once per feature, dismissible, never
   recurring. No tours, no modal tips. The notification tip appears once, after a background task finished
   while the tab was hidden.
7. **Empty means teach.** What this is, why it matters, one button that does the next step.
8. **Errors are sentences with a fix.** "What happened, what to do", never a status code, path or env var.
9. **Progressive disclosure.** Advanced features appear when relevant (cards after a chapter exists; practice
   after cards; admin settings only for admins). Nothing advanced in the first-run flow.
10. **Forgiving forms.** Sensible defaults, inline validation, Enter submits, focus starts in the first
    field, no disabled button without the reason shown next to it.
11. **Touch first.** 44 px targets, bottom-reachable primary actions, safe-area padding, no hover-only UI.
12. **Escape and back always work.** Esc closes the top overlay; the browser back button closes a sheet.
13. **Stable layout.** Skeletons match final size; no content jumps when data arrives.
14. **Motion respects the user.** Honour `prefers-reduced-motion`; no motion over 200 ms.

## 5. Changes sections 3–6 will make

### Section 2 (design system): supports the rest
- `components.json`, shadcn Base UI components (Badge, Card, Empty, Skeleton, Spinner, Separator), docs in
  `docs/DESIGN.md`. Hand-rolled overlays stay until the section that touches them moves them to the shared
  Dialog/Sheet (closes F9).

### Section 3: Navigation and information architecture
- Phone bottom tab bar (Today · Notes · Practice · Search · More); "More" sheet. Remove hamburger as primary.
  (F2)
- Desktop sidebar regrouped into Study / Library, Activity and Settings at the bottom. Keep set switcher. (F2)
- Chat button only inside a set, above the tab bar, never over an action bar; Inbox review bar fixed. (F5)
- Renames per the glossary: Inbox → To review, Jobs → Activity, role names, tiers → source quality. (F3)
- Set home → "Continue": one primary action from Today's do-next, small secondary row, "More actions" for
  the rest, no orphan card. Drop zero counters on Today. (F6)
- Settings grouped Personal / Learning / Admin; admin items hidden from non-admins.
- Note toolbar: Read first; Edit, History, Highlights, Reading settings, Full screen in a "⋯" menu.

### Section 4: First-run and beginner guidance
- First-run flow (goal → depth → deadline → material → create set → Make a plan). Skippable, resumable. (F1)
- Empty states for Today, Notes, Cards, To review, Library, Activity with one next-step button. (F10)
- First-use hints (one at a time, once). No tours.
- `web/src/lib/friendly-errors.ts` with tests, used for job failures, Firecrawl, AI disabled, rate limits. (F4)
- Level names in the plan options; friendlier deadline input.

### Section 5: Calm interactions
- Toast policy (merge, 3 s success, sticky failure with action, notification tip rules). (F7)
- Undo toasts for archive/delete of notes, highlights, suggestions, sources where the server can revert;
  native `confirm()` removed. (F8)
- Skeletons, optimistic updates (highlights, card approve/reject, settings toggles), no layout shift.
- Forms: Enter submits, autofocus, inline validation, reasons for disabled buttons. Escape/back close overlays
  (move hand-rolled overlays to Dialog/Sheet). (F9)
- 44 px targets, focus rings, reduced motion, icon-button labels, AA contrast script over theme tokens.

### Section 6: Fast and offline
- Route and heavy-library code-splitting (mermaid, KaTeX, highlight.js); target < 250 kB gzip initial JS
  (today: main chunk about 423 kB gzip).
- Offline reading of recent notes, sources, highlights with an "Offline" banner; offline writes blocked with a
  clear message; caches cleared on sign-out.
- LCP/INP measured for Today and a note.

### Section 7: Leftovers
- Book callouts never orphaned; persistence of pending site imports and chat proposals across restarts;
  `docs/INSTALL.md`; security pass.

## 6. Beginner walkthrough: baseline (before M6)

First-timer on a phone, fresh instance. Steps, taps, and what happens.

| Step | Taps | Result today | Friction |
|---|---|---|---|
| Open the URL | 0 | Redirect to `/setup` | fine: username + password |
| Create admin | 4 fields | Empty page "Create your first study set" | F1 no guidance on what comes next |
| New study set | 2 | Dialog: title, optional goal, checkbox | goal/level/plan hidden (F1) |
| Set home | 1 | Five cards, Book card, how-it-works list | F6; "(not set yet)" raw text |
| Add a source | 3 | Full-screen sheet; Esc does not close | F9 |
| New chapter | 3 | Title/brief/sources form; failure shows an error toast with a file path | F4, F7 |
| Make cards | unclear | Hidden in the note toolbar; Cards page tells you to "open a note" | F10, F3 |
| Practice | n/a | Not on `main` | see Practice |
| Book | 1 | "Not built yet" card on an empty set; raw pandoc error if tools are missing | F4 |

Returning learner: Today shows one card and raw counters; to get to the note list on a phone the learner
opens the drawer; the note toolbar wraps; reading is fine; the chat button overlaps text and bars.

**Targets after M6 (re-run at the end of the series):** first set created and plan started in ≤ 6 taps
after setup; one obvious primary action on every screen; zero raw errors; zero native confirms; no bar
overlaps; initial JS < 250 kB gzip; offline reading works.

## 7. Measures for the final re-run

- Phone walkthrough above, step by step, with taps counted.
- Returning learner: open → Today → continue → review → practise in ≤ 4 taps to start the next thing.
- Automated: contrast AA over every theme token pair (script in section 5), `axe`-style label check for icon
  buttons, bundle size from the build, LCP/INP from section 6.

## 8. Re-run results

*(Filled in at the end of the M6 series.)*
