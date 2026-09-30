# M4-5 — Compile a set into a PDF book (Pandoc → Typst)

You are the IMPLEMENTER in /home/krishna/learny-worktrees/m4-5 on branch codex/m4-5 (a git worktree of /home/krishna/learny). Do not load orchestration skills and do not spawn sub-agents. Read `AGENT_MEMORY.md` (in your worktree) first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

Rules:
- Never commit or push. Never edit `AGENT_MEMORY.md` anywhere: put your 5-line log entry in the final report.
- Never touch `.env*`, `data/`, `.claude/` or `web/` (UI comes from Sonnet).
- Only stop processes you started (save `$!`); never pkill or killall.
- Targeted tests per AGENTS.md, in tmp dirs.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
- Standing permission: minimal integration edits your task forces (imports, route mounts in `server/src/app.ts`, job registration in `server/src/workspaces/manager.ts`, type unions in `shared/src/api.ts`, the jobs route validator). List each one in the report.

End with the AGENTS.md final report plus the log entry.


## Goal
One click gives the learner a readable PDF book of a set. Decision 3: the output goes to `<set>/.cache/book/<set>.pdf` (not committed). `pandoc` 3.12 and `typst` 0.15.1 are installed in `~/.local/bin` (on the service PATH); run tests with `PATH="$HOME/.local/bin:$PATH"`.

## Pieces
1. **Job** kind `compile-book` (`shared` `JobKind`, `server/src/jobs/book-job.ts`, registration, validator). Input `{set}`. No AI and no model: exempt it from the AI gate in `server/src/server.ts` (`aiRouteDisabled`) only if `POST /api/jobs` with `kind: "compile-book"` would otherwise be blocked. Make the gate check the kind.
2. **Assemble:**
   - notes from `listNotes` (sorted by `order`), bodies without frontmatter
   - a title page from `PLAN.md` (title, goal, date)
   - each note is a chapter; demote its internal headings under the chapter heading
   - directives `:::definition`, `:::theorem`, `:::example`, `:::deeper` become Pandoc fenced divs with classes (Pandoc reads `:::` natively), rendered as boxed callouts in Typst by a Lua filter `server/templates/book/callouts.lua`
   - mermaid blocks: render to SVG with `@mermaid-js/mermaid-cli` ONLY if it's already a dependency. Otherwise replace them with a short italic note "(diagram in the app)". Don't add big dependencies.
   - citations `[^src:<id>#loc]` become footnotes with the source title from `library/<id>/source.md`, plus a Bibliography chapter at the end listing the used sources (title, author, URL or publisher, tier)
3. **Convert:**
   - `pandoc -f markdown+tex_math_dollars+fenced_divs -t typst --lua-filter callouts.lua --template server/templates/book/book.typ` to a temp dir
   - then `typst compile book.typ out.pdf`
   - use `execFile` with fixed argv arrays: no shell, no user input as flags, a 120 s timeout each, stderr captured and redacted into the job error
   - the temp dir is under the workspace `.cache`, cleaned afterwards
4. **Template** `server/templates/book/book.typ`:
   - A5 or A4 (choose A5 for reading on a phone/tablet; document it)
   - readable body type (e.g. "New Computer Modern" or "Libertinus Serif" if bundled with typst; otherwise typst's default)
   - table of contents, chapter page breaks, page numbers, running header with the set title
   - maths sized to the body, and styled callout boxes
5. **Route** `GET /api/sets/:set/book.pdf`: streams the last built PDF (404 if none) with `content-disposition: attachment; filename="<set>.pdf"`. `HEAD` reports whether one exists and its mtime.
6. **Docker:** add pandoc and typst to `Dockerfile` (pinned versions 3.12 / 0.15.1, official release tarballs with sha256 verified) and note it in `docs/DEPLOY.md`.

## Tests
- assembling on a tmp copy of `examples/sample-set` (order, frontmatter stripped, footnotes, bibliography)
- a real pandoc + typst run producing a PDF over 10 KB, skipped with a clear message if the binaries are missing
- the route streams it; a traversal set → 404/400
- the job is not blocked for AI-disabled users (if you changed the gate)

Run:
- `PATH="$HOME/.local/bin:$PATH" pnpm --filter @studium/server exec vitest run src/jobs src/routes src/server.test.ts`
- `tsc`
