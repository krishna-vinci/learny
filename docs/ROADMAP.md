# Roadmap

Locked 2026-09-28 (D20). MVP = M0 + M1 + M2.

**Status (2026-09-29):** M0, M1, M2 done — each verified end-to-end (API + real models + browser at 390/1440 px; M2 `.apkg` validated with the official Anki importer). M3 done: M3a 2026-09-29 (accounts + SSO, per-user trees, restic backups, ntfy/Web Push, export, systemd user service), M3b 2026-09-30 (background jobs UX, reading comfort, themes). Next: M4 (D28). Anki stays `.apkg` + frozen browser sync (D23).

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
| M3a | Platform | always-on service (systemd user unit + compose), Memos-style accounts (SQLite: users, sessions, tokens, OAuth2 IdPs, instance settings; first-run admin setup; sign-up toggle; SSO templates), one study tree per user + migration of `data/study`, restic backups set up entirely in the UI (any backend, test connection, recovery kit, schedule, retention, restore, check, status), ntfy + Web Push plumbing, "download all my data" (D24–D27) | two accounts see only their own sets; SSO login works; nightly backup restores a deleted note |
| M3b | Comfort | background jobs UX (global activity indicator, "drafting…" placeholders, done/failed notifications, no forced navigation), reader settings (font size, width, serif/sans), full-screen reading, themes (light/dark/sepia/black + accents) | draft 3 chapters while reading another; adjust text on phone |
| M4 | Study loop | Today page, search (⌘K: notes, sources, cards, chats), selection actions (ask / explain simpler / make card / highlight), set intake + Outliner (outline → approve → queue drafts), book PDF (Pandoc → Typst), MinerU | app says what to do today; a set compiles to a PDF book |
| M5 | Practice | quizzes + weak-spot log, teach-back (tutor grades your explanation), problem sets with worked solutions; weak spots feed Today | a weak topic from a quiz shows up on Today |
| M6 | Polish | full shadcn/ui (Base UI) migration (`docs/prompts/m3b-slice-d.md`, D1–D5), Scout (find new sources), offline reading, M0–M2 follow-ups, code-splitting, i18n, public release | |

## M0 follow-ups (deferred, 2026-09-28)

- Revert scope: a commit shown in one set's history may touch another set; scope `POST /revert` to the set's paths or warn (audit finding 6).
- `editFile`/`createFile` enforce the agent write allowlist; the M1 manual note editor needs a user-write path with its own rules.
- `PLAN.md` / note frontmatter fall back to defaults when any single field is invalid; make the fallback per field.
- Directive attributes (`:::definition{title="…"}`) are not rendered yet.
- Web bundle is ~540 kB+ (mermaid, katex, highlight.js); add code-splitting.
- Pending Tutor job proposals are only in the event stream; after a reload the card is gone. Persist unexpired proposals per chat and re-render them.
- A resumed ingest job keeps the URL-derived title instead of the source title.
- `initStudyTree` writes `_global/mcp.json` without committing it, and the job runner appends to `<set>/log/jobs.md` without committing — commit both (author system) so the tree stays clean.
