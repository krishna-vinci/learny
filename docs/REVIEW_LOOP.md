# Review Loop — Anki + Quiz

Locked 2026-09-28 (D16). Scheduling lives exclusively in Anki (P2).

## Export

- Math: cards are authored with `$…$` / `$$…$$`; the exporter converts to Anki MathJax
  `\(…\)` / `\[…\]`.
- Note GUID = card id (`c-8f3a`). Re-importing an updated `.apkg` updates existing notes
  instead of duplicating them.
- Images from `library/*/assets/` are packed as media.

## Anki layout

| Thing | Value |
|---|---|
| Deck | `Studium::<set>::<NN-chapter>` |
| Note types | `Studium Basic`, `Studium Cloze` — fields: Front, Back, CardId, Source, NoteLink |
| Tags | `studium`, `set::<slug>`, `src::<id>` |

## Paths

| Tier | Flow |
|---|---|
| Basic | UI "Export approved cards" → `.apkg` download → user imports (desktop or mobile) |
| Advanced | UI "Sync to Anki" → AnkiConnect `addNotes` / `updateNoteFields` by CardId → `status: exported` + Anki id written back |

AnkiConnect is desktop-only; phone reviews reach it through AnkiWeb sync.

## In-app quiz

- `quiz-me` skill in chat; questions drawn from notes and cards, including non-card
  questions (application, explain-why).
- Never affects Anki scheduling.
- Results appended to `<set>/log/quiz.md` (date, topic, question, right/wrong, gap).
- A miss produces an offer: add card, revise card, or add example to the note (P10).

## Retention telemetry (advanced)

- Daily scheduler job (plain code, no LLM) pulls review history for `tag:studium` via
  AnkiConnect → `<set>/log/retention.md`: per-chapter retention, lapses, leeches, due count.
- Leeches become proposed Critic rewrite jobs.
- Basic tier: no telemetry; the UI states it.

## Stale cards

A commit touching `notes/NN-*.md` flags linked cards `stale?` in the UI with an optional
"re-check cards" job. No automatic rewrites.

## Daily surface

- In-app **Today** page: Anki due count (advanced), pending approvals, `requests.md`
  backlog, leech fixes, each PLAN's `next_action`.
- Optional daily summary to a webhook URL (ntfy / Apprise / Gotify).

## Mastery (M4)

Rules deferred; inputs captured from day one (`retention.md`, `quiz.md`, exercises).
Draft rule: retention ≥ 85% over 30 days + quiz ≥ 80% + teach-back pass → level + 1.
