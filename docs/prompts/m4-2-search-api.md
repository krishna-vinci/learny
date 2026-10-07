# M4-2 — Search API (SQLite FTS5 per user)

You are the IMPLEMENTER in /path/to/studium-worktrees/m4-2 on branch codex/m4-2 (a git worktree of /path/to/studium). Do not load orchestration skills and do not spawn sub-agents. Read `/path/to/studium/AGENT_MEMORY.md` first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

Rules:
- Never commit or push.
- Never touch `.env*`, `data/`, `.claude/` or `web/`. UI comes later, from Sonnet.
- Only stop processes you started yourself (save `$!`); never `pkill` or `killall`.
- Tests are targeted per AGENTS.md; tests use tmp dirs, never real `data/`.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
- Standing permission: minimal integration edits your task forces (imports, a route mount line in `server/src/app.ts`, type unions in `shared/src/api.ts`). List each one in the report.

End with the AGENTS.md final report plus a 5-line log entry for AGENT_MEMORY.md.


## Goal
Fast full-text search over one user's study tree: notes, sources, cards and chat titles. The index lives at `<tree>/.cache/search.db`, which is gitignored (`.cache/` is in `REQUIRED_IGNORES`) and rebuildable.

## Where
- `server/src/search/index.ts`:
  - `openSearchIndex(root)`, `rebuildAll()`, `upsertPath(rel)`, `removePath(rel)`, `query({q, set?, kinds?, limit})`
  - `node:sqlite` `DatabaseSync` with FTS5 `tokenize='porter unicode61'` (verified to work)
  - columns: `kind` (note | source | card | chat), `set`, `path`, `title`, `body`
  - snippets via `snippet(...)` with `[[` `]]` markers; bm25 ranking with title weighted above body
- Sources: `library/<id>/source.md` plus `parsed.md` / `parsed/*.md`. Library sources are user-global (set = null) but carry their linked sets.
- Cards: `<set>/cards/*.md`, one row per card id with Q/A text.
- Chats: title only, from `<set>/chats/*` metadata; see `server/src/agent/chat-service.ts` for the format.
- Wire it into the workspace:
  - `server/src/workspaces/manager.ts` creates the index per workspace and rebuilds it at start (non-blocking)
  - it subscribes to the workspace `EventHub` `{type:"file"}` events (`server/src/watcher.ts`, event shape in `shared/src/api.ts:155`) to upsert/remove the path
- Route `server/src/routes/search.ts`: `GET /api/search?q=&set=&kind=&limit=` (limit ≤ 50, q ≤ 200 chars). Returns `{results:[{kind,set,path,title,snippet,score}]}`. Mount it in `app.ts`.
- Sanitize user input into an FTS5 query: quote terms, allow prefix `*` on the last term, never pass raw syntax through.
- Only indexed paths inside this workspace root; nothing outside it.

## Tests
`server/src/search/index.test.ts` on a tmp copy of `examples/sample-set`:
- finds a phrase in a note, a source and a card
- stemming works (decompose ↔ decomposition)
- set filter
- an update after a file change
- delete
- a hostile query string (`"`, `*`, `NEAR(`, `)`) doesn't throw

Plus a route test.
- `pnpm --filter @studium/server exec vitest run src/search src/routes/search.test.ts src/workspaces`
- `tsc`
