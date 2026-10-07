# M4-3 — Selection quotes in chat + highlights API

You are the IMPLEMENTER in /path/to/studium-worktrees/m4-3 on branch codex/m4-3 (a git worktree of /path/to/studium). Do not load orchestration skills and do not spawn sub-agents. Read `/path/to/studium/AGENT_MEMORY.md` first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

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
The reader can send a selected passage to the tutor, and save highlights per note.

## A. Quoted passage in chat
- `server/src/agent/routes.ts:55-69`: accept an optional `quote` (string, ≤ 4000 chars; 400 otherwise) next to `anchor`, and pass it to `chats.send`.
- `server/src/agent/chat-service.ts` `send(set, id, text, anchor?)` (~line 508): add `quote?` and include it in the tutor's user turn, as the tutor already receives the anchor note, e.g. a "Selected passage from <anchor>:" block quoted verbatim before the learner's text. Keep the message shown in the chat transcript as the learner's text plus a short quote marker. Follow how `anchor` flows today.
- Test: a faux-provider chat test asserting the quote reaches the model context and appears in the transcript.

## B. Highlights
- Storage (plan Decision 2): `<set>/highlights/<note-file>.json`, an array of `{id: "h-<8hex>", quote, prefix, suffix, color: "yellow"|"green"|"blue"|"pink", note?: string, createdAt}`.
  - `quote` ≤ 2000 chars; `prefix`/`suffix` ≤ 64 chars each
  - `note` ≤ 1000 chars
  - at most 500 highlights per note
- Route module `server/src/routes/highlights.ts` mounted in `server/src/app.ts` at `/api/sets/:set/highlights`:
  - `GET ?note=notes/NN-x.md` → `{highlights}`
  - `POST {note, quote, prefix, suffix, color, note?}` → 201 `{highlight}`
  - `PATCH /:id {note, color?, note?}`
  - `DELETE /:id?note=`
- The note path must match `^notes/[a-z0-9][a-z0-9._-]*\.md$` and exist. Resolve via `resolveInRoot`.
- Write under `FileLocks` with atomic writes (reuse `server/src/tree/edit.ts` helpers). Commit `user: highlight <note title>` via `commitPaths`, author `user`, and publish a `{type:"commit"}` event like the sets routes do.
- Tests: CRUD, path confinement (`../`, `cards/x.md` → 400), caps, commit author.

## Tests
- `pnpm --filter @studium/server exec vitest run src/routes/highlights.test.ts src/agent src/tree`
- `tsc`
