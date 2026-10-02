# UI

Locked 2026-09-28 (D18). Stack: D4 (React, Memos-derived). Memos reference at
`reference/memos/web/src` (MIT; keep notice on copied code).

## Reused from Memos

| Memos | Becomes |
|---|---|
| `components/AppSidebar` (resizable, mobile drawer) | main nav |
| `AppSidebar/SpaceSwitcher` | study-set switcher |
| `AppSidebar/QuickFindDialog` (⌘K) | search notes / sources / cards / chats |
| `components/MemoContent` (math, mermaid, code, tables, tasks) | note reader + our directives |
| `components/MemoEditor` (CodeMirror) | manual note editing |
| `components/Inbox` | approvals inbox |
| `components/ActivityCalendar` | study heatmap |
| `pages/SignIn`, `AuthPageLayout` | login |
| `pages/Setting` | settings shell |
| theme tokens, `components/ui` | everything |

## Layout (desktop)

Three panes: sidebar (set switcher, Today, Notes, Library, Cards, Inbox, Jobs, Settings) ·
reader (center) · chat dock (right, resizable, collapsible).

## Reader

- MD + math + mermaid + directives; `:::deeper` collapsible.
- Citation hover: source title, tier, page, link to original.
- Text selection menu: Ask about this · Explain simpler · Make card → chat anchored to selection.
- Edit mode (CodeMirror); user edits commit as `user: …`.
- History: git log per note, diff per agent change, Revert.

## Chat dock

- Chat list per set; new chat; anchor chip (note / source / selection).
- Streaming; tool calls as collapsed chips.
- Rich cards: job confirm (cost + Run), edit summary (+lines, view diff), quiz questions
  (MCQ / free answer, graded inline).
- Steer / follow-up while streaming; Stop.
- Own component on shadcn primitives, driven by Pi events (no assistant-ui).

## Today

Anki due count, pending approvals, requests backlog, leech fixes, each set's
`next_action`, study heatmap.

## Inbox (approvals)

- Cards: rendered Q/A + critic verdict; keys `a` approve · `e` edit · `r` reject ·
  `j/k` next/prev; "approve all critic-clean".
- Chapters: diff + Checker issues + accept.
- Plans: draft + approve.

## Library

Source list (tier badge, parse tier, linked sets); detail = `source.md` + parsed viewer;
Add-source dialog with live progress.

## Jobs

Running / queued / history; cost per job; cancel.

## Settings (view over `_global/config.yaml`)

Models per role (warn when drafter = checker) · service health dots (MinerU, SearXNG,
Firecrawl, AnkiConnect, each MCP) · budget · webhook. Secrets shown only as set/unset.

## Live updates

Single SSE stream: chat tokens, job progress, file changes. A study-tree watcher makes
external edits (Obsidian, VS Code) appear live.

## Mobile

Desktop first. Mobile must handle reading, chat and approvals; reader and chat swap
full-screen. Installable PWA. Mobile editing is a non-goal.

## Media in the reader (D29, D31)

Images resolve relative to the note and stay inside the set's assets/artifacts,
with lazy decoding/loading and a descriptive caption. Unsaved HTTPS images remain
images in the app, but only caption + URL text in the book. Raw note HTML is blocked.

Valid YouTube video links in ordinary Markdown (bare/autolink, labelled or reference
links) also receive a player after their paragraph/heading,
keeping the original text and
links usable. Supported forms include watch/share/shorts/live/embed/v, mobile,
music and nocookie URLs, with optional tracking/playlist parameters. Times use
`t`, `start`, `time_continue` or `#t=`, in seconds or `1h2m3s` form. Invalid URL times
fall back to the whole video; explicit directive times must be safe nonnegative
integers and end must follow start. Exact known hosts/video paths and 11-character
IDs are required; credentials, unusual ports, lookalike hosts, channel/playlist
pages and code examples never become players. Chat continues to show plain links.

A YouTube moment starts as a local library thumbnail or neutral placeholder with
Play video. Only a tap creates the nocookie iframe with start/end; Watch on YouTube
is always available. Timestamp citations show “at 14:03” and a timed YouTube link.
Vega-Lite fences lazy-load a responsive SVG chart with theme-token colors; invalid
specs stay visible as code with “Chart couldn't be drawn”.

Every chapter has Reading / Visuals tabs above the body. Visuals shows an attachment
count only when nonzero, the chapter title, and an ordered vertical list of titles,
posters and Run actions. It uses the full reader width with a viewport-height canvas
on phones, while Reading keeps the learner’s prose measure. Empty Visuals explains
the space and offers Return to reading; invalid references remain unavailable entries.
A skeleton fills the canvas while its code/HTML opens. Run failures offer retry;
offline uncached visuals explain that a connection is needed. Switching back stops
iframes and restores Reading’s saved scroll and highlights. `?view=visuals` opens
the tab directly; browser back returns to the prior view. Tabs support keyboard
navigation and use the existing theme tokens and 44px touch targets. The view controls stay reachable while scrolling; browser
scroll anchoring is disabled in the reader so lazy media cannot displace the saved
reading position.

Standalone `::artifact` declarations are chapter attachments, collected in order
and omitted from Reading. Existing inline declarations work without a data rewrite.
Only Run fetches local HTML and creates a scripts-only iframe with a first-document
CSP; never `allow-same-origin`. Full screen uses CSS and portals to the body; Escape
exits. Successful file and image reads use the existing bounded offline API cache, cleared on sign-out. Chat shows
media directives as plain links and only local images from its own set.

Books use local images, YouTube thumbnails with times/links, light chart SVGs and
a chapter-end “Visuals in Studium” section with artifact posters/titles and a
pointer to that chapter’s Visuals tab. Missing posters become text pointers. Mermaid’s
existing diagram-in-the-app caption remains until mmdc rendering is implemented.

### Teaching visuals (D32)

The existing Reader Visuals tab gains auto-starting built-in widgets and local sketches.
Widgets supply labelled SVG geometry, sliders/selection and the same story chrome as
sketches: Play/Pause, Previous/Next, scrub, scene buttons and a narration sentence.
Controls are ≥44 px; phone canvases use viewport height with controls below. Loading
reserves canvas space; errors offer a retry; chapters without visuals keep D31's empty
state. Legacy artifacts keep Run. At ≥50% visibility visuals autoplay and pause when
hidden/offscreen; reduced motion starts paused. Phones run only the most visible sketch.
Leaving the tab unmounts frames. Theme/accent changes recolour visuals using the app's
system font and contrast-mapped Okabe-Ito palette. No scroll-synced scenes in this version.
