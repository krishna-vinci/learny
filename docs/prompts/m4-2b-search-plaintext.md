# M4-2b — Search index stores plain text (snippet cleanup)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/m4-2b` on branch `codex/m4-2b`. Do not load orchestration skills and do not spawn sub-agents. Read `AGENT_MEMORY.md` first.
- Never commit or push; never edit `AGENT_MEMORY.md` (put a 5-line log entry in your report).
- Never touch `.env*`, `data/`, `.claude/` or `web/`.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step doesn't fit the code, stop and report file:line.

## Problem
Search snippets show raw markdown and diagram source, e.g. `…U["U"] --> Ax["A x"] ``` ## Why it matters for ML`. The index body in `server/src/search/index.ts` is the raw file text.

## Change
In `server/src/search/index.ts`, index a plain-text body for notes, sources and cards:
- strip YAML frontmatter
- remove fenced code blocks entirely, both ``` and ~~~, including mermaid (code isn't search content for now)
- remove footnote definitions (`[^src:…]: …`) and footnote references
- remove directive fences (`:::definition`, `:::` lines, `{title="…"}` attributes) but keep their inner text
- drop heading `#` markers, list markers, emphasis markers, link syntax (keep the link text) and image syntax
- keep `$…$` / `$$…$$` maths as plain text (it's searchable), but collapse runs of whitespace

Put this in a small pure helper `server/src/search/plaintext.ts` with unit tests (`plaintext.test.ts`). Keep titles as they are. The index rebuilds at workspace start, so existing indexes pick this up after a restart. If the schema or version needs bumping so old `search.db` content is rebuilt, do it; check how `rebuildAll` works.

## Tests
- `pnpm --filter @studium/server exec vitest run src/search src/routes/search.test.ts`
- `tsc --noEmit` for server

Add a test that a note containing a mermaid block and footnotes produces a snippet without `-->`, `` ``` ``, `[^src` or `#`.
