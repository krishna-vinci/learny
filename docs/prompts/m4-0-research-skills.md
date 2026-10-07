# M4-0 — Research skills + default-skill sync

You are the IMPLEMENTER in /path/to/studium-worktrees/m4-0 on branch codex/m4-0 (a git worktree of /path/to/studium). Do not load orchestration skills and do not spawn sub-agents. Read `/path/to/studium/AGENT_MEMORY.md` first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

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
The research agents use the new tools deliberately, and your existing study trees receive improved default skills without losing user edits.

## A. Skill text (`skills/*/SKILL.md`; the files are copied into each user tree under `_global/skills/`)
Tools the agents actually have (see `server/src/agent/roles.ts` and `server/src/agent/builtins/`):
- `web_fetch` renders pages through Firecrawl when configured.
- `add_source` ingests a URL into the library (Firecrawl → clean markdown). Tutor only.
- the Wikipedia builtin
- MCP tools, whose names are `mcp_<server>_<tool>`:
  - `searxng`: web search
  - `papers`: paper search/read, e.g. `mcp_papers_search_papers`, `search_arxiv`, `search_semantic`, `read_arxiv_paper`
  - `context7`: library/API docs (resolve library id, then get docs)

Check the exact tool names in `server/src/mcp/bridge.ts` (normalization) and cite them by pattern.

1. **New `skills/find-sources/SKILL.md`** (tutor, librarian), the research playbook. Research tool by material:
   - papers: `papers` (prefer arXiv or Semantic Scholar records; check venue, year, citations)
   - library/API docs: `context7` (note the version)
   - general: Wikipedia, then `searxng`

   Evaluating and registering:
   - read candidate pages with `web_fetch` first
   - anything to be cited gets registered with `add_source` (or reported to the owner when the role lacks it); never cite unregistered material
   - credibility tiers A–D exactly as in `skills/source-summary/SKILL.md`
   - output: a short ranked list with why each source fits the set's `PLAN.md` level
2. **`draft-chapter`:**
   - gap report: when registered sources don't cover part of the brief, list the missing concepts and propose specific sources (via find-sources), instead of thin or uncited prose
   - no central claim from model memory
   - code examples checked against Context7, with the library version stated
3. **`fact-check`:** independent checks by claim type:
   - Context7 for code/API
   - `papers` for "paper X shows Y"
   - SearXNG last, marked lower trust

   A web source whose parse tier was the fallback extractor (see `source.md`/warnings) gets re-read with `web_fetch` before accepting a claim. Outdated code is `major`.
4. **`source-summary`:** check the parse tier and text quality. Garbled or empty text → say so, lower the tier, flag for re-ingest; never summarise junk.
5. **`explain`:**
   - library usage → Context7; recent events → SearXNG
   - offer "add this to your library?" for useful finds
   - cite
6. **`evolve-note`:** new facts from web/docs lookups must be a registered source before entering a note; keep citations.
7. **`note-authoring`:** code blocks state the library version checked; a Context7 page counts as a source only once it's registered.
8. **`make-deck`:** no card on version-specific API details unless the card states the version.
9. **`critique-cards`:** reject version-specific facts that don't state a version.
10. **`quiz-me`:** unchanged.
11. **`server/src/agent/roles.ts`:** add `"find-sources"` to the tutor and librarian `skills` arrays (lines ~39 and ~52). Update role tests if they pin the lists.

Keep each skill's existing structure and tone. Only add what's listed.

## B. Default-skill sync (`server/src/tree/init.ts`, `ensureDefaultSkills` at ~line 55)
Today it only copies missing skill dirs, so improved defaults never reach existing trees.
- Add `server/src/tree/skill-sync.ts` exporting `syncDefaultSkills(root)`, called from `ensureDefaultSkills` (or `initStudyTree`) on every boot. For each default skill dir, compare each file in the user tree:
  - identical → skip
  - equal to a **known previous default** (sha256 in a committed manifest `skills/.defaults-history.json`: `{ "<skill>/<file>": ["<sha256>", …] }`) → overwrite with the new default
  - anything else → user-edited: leave it and log `studium: kept user-edited skill <path>`
- Generate the manifest with a small script `scripts/skill-history.mjs`. It appends the current hashes of every `skills/**` file and is run before committing skill changes. Seed it with the hashes of the skills *as they are on main before your edits* (`git show main:skills/...`), plus the new ones.
- After updating, commit the changed skill files in the user tree: `system: update default skills` (use `commitPaths`, author `system`).
- Tests in `server/src/tree/skill-sync.test.ts`: untouched old default → updated and committed; user-edited → kept; missing → copied.

## Tests
- `pnpm --filter @studium/server exec vitest run src/tree src/agent/roles.test.ts`
- `pnpm --filter @studium/server exec tsc --noEmit`
- biome on changed TS files
