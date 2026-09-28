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
