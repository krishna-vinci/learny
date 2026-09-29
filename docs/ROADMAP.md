# Roadmap

Locked 2026-09-28 (D20). MVP = M0 + M1 + M2.

**Status (2026-09-29):** M0, M1, M2 done — each verified end-to-end (API + real models + browser at 390/1440 px; M2 `.apkg` validated with the official Anki importer). Next: M3.

## Repo layout

```
learny/                     # pnpm workspaces
├── server/                 # Hono · agent/ (Pi wrapper) · jobs/ · ingest/ · tree/ (fs, lock, git) · anki/
├── web/                    # React (Memos-derived)
├── shared/                 # zod schemas (frontmatter, config), types, AnkiConnect client
├── skills/                 # default skills, copied into a new study tree on init
├── examples/sample-set/    # hand-made study tree for dev, tests, first run
├── docs/
├── Dockerfile · compose.yaml
└── reference/memos/        # gitignored
```

## Milestones

| M | Name | Contents | Done when |
|---|---|---|---|
| M0 | Skeleton | monorepo, Hono + Vite, Memos shell (sidebar, login, theme), study tree init + schema, reader (MD + math + mermaid + directives), file watcher → SSE, git auto-commit + history/revert, Tutor chat via Pi with read/edit tools, multiple chats per set, Dockerfile | chat adds an example → note updates live → diff visible and revertible |
| M1 | Sources → Notes | MCP bridge (paper-search, wikipedia, SearXNG, Firecrawl), basic ingest (PDF, web, wiki, YouTube, EPUB/DOCX) + `_inbox/` watcher, Librarian, Library UI, job runner + cost, settings (models, health), skills (`explain`, `evolve-note`, `note-authoring`), Drafter → Checker, Inbox (chapters), citation hovers | add a book + 2 papers → cited, fact-checked chapter → refined in chat |
| M2 | Cards & review | Cardsmith → Critic, card files, keyboard inbox, `.apkg` export, browser AnkiConnect sync, `quiz-me` + quiz log, stale-card flags | chapter → approved cards → in Anki on phone |
| M3 | Plan & daily loop | intake + Outliner, Today page, retention pull + leeches, webhook nudge, MinerU, book PDF, server-side AnkiConnect | app says what to do today and learns from Anki stats |
| M4 | Mastery | Scout, placement quiz, levels, teach-back, problem sets, literature review | |
| M5 | Polish & ecosystem | PWA, git remote backup, migration tooling, i18n, skill gallery, public release | |

## M0 follow-ups (deferred, 2026-09-28)

- Revert scope: a commit shown in one set's history may touch another set; scope `POST /revert` to the set's paths or warn (audit finding 6).
- `editFile`/`createFile` enforce the agent write allowlist; the M1 manual note editor needs a user-write path with its own rules.
- `PLAN.md` / note frontmatter fall back to defaults when any single field is invalid; make the fallback per field.
- Directive attributes (`:::definition{title="…"}`) are not rendered yet.
- Web bundle is ~540 kB+ (mermaid, katex, highlight.js); add code-splitting.
- Pending Tutor job proposals are only in the event stream; after a reload the card is gone. Persist unexpired proposals per chat and re-render them.
- A resumed ingest job keeps the URL-derived title instead of the source title.
