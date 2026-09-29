# UX: set home, new chapter/set/note, note editing, job history

**Goal:** a phone user who opens the app sees their set, its notes and clear next actions;
can start a chapter, create a study set, write/edit a note by hand; job history survives restarts.

**Why:** the user reported "no notes, no way to add notes". Cause: `/s/:set` is still the M0
placeholder (`web/src/router.tsx` `SetOverviewPlaceholder`), notes hide behind the phone drawer,
"New chapter" lives only on the Inbox page, no create-set or note editor exists (UI.md "Edit
mode"), and `JobRunner` is memory-only.

Specs: `docs/UI.md`, `docs/STUDY_TREE.md`. Mobile editing stays simple (textarea), per UI.md.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw).

## API contract (server task S1 builds it, web task W1 consumes it)

1. `POST /api/sets` body `{ title: string, goal?: string }`
   - title trimmed, 1–120 chars; goal ≤ 2000 chars. Else 400 `{error}`.
   - slug = title lowercased, non `[a-z0-9]` runs → `-`, trimmed of `-`, max 40 chars;
     empty → `set`; `library` or existing dir → append `-2`, `-3`, …; must pass `isSetSlug`.
   - writes `<slug>/PLAN.md`:
     ```
     ---
     title: <title>
     status: active
     level: 1
     sources: []
     next_action: Add a source, then start a chapter
     ---

     ## Goal

     <goal or "(not set yet)">
     ```
     and creates empty dirs `notes/`, `cards/`, `log/`. Commit `user: create set <title>` (author `user`, `commitPaths` on the PLAN.md).
   - 201 `{ slug }`.
2. `POST /api/sets/:set/notes` body `{ title: string }` (1–120 chars)
   - path `notes/NN-<slug>.md`, NN = (max existing numeric prefix in `notes/`) + 1, 2-digit zero-padded; slug rule as above (max 50).
   - content `---\ntitle: <title>\norder: <NN as number>\n---\n\n# <title>\n\n`.
   - Commit `user: create note <title>`. 201 `{ path: "notes/NN-slug.md" }`. 404 unknown set.
3. `PUT /api/sets/:set/file` body `{ path: string, content: string, previous: string }`
   - only `path` matching `^notes/[a-z0-9][a-z0-9._-]*\.md$` (else 400), content ≤ 1 MB (else 413).
   - under FileLocks (holder `user`): file must exist (404); if current text !== `previous` → 409 `{ error: "changed", current }`.
   - atomic write, commit `user: edit <note title or path>`; 200 `{ sha }` (sha may be null when unchanged).
   - after each commit in 1–3 publish `hub.publish({ type: "commit", sha, subject, author })` like `POST /:set/revert` in `server/src/routes/sets.ts`.
4. `GET /api/jobs` unchanged shape, but after restart it also lists past jobs parsed from
   `*/log/jobs.md` and `library/_jobs.md` (id `log:<set|library>:<line no>`, status from the line,
   `progress: ""`, `billing: "metered"`, usage input/output/costUsd from the line, `result.commitSha` if present).

## Tasks

| id | who | scope |
| --- | --- | --- |
| S1 | codex `sol` | `server/` only: routes 1–4 + tests |
| W1 | Sonnet subagent | `web/` only: home page, sheets, editor, audit |

Both run in worktree `~/learny-worktrees/ux-home` (branch `codex/ux-home`), disjoint dirs.
Final: orchestrator merges, builds web, restarts server, clicks through at 390px and 1440px.
