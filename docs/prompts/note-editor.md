# A real note editor

Work in your own worktree/branch; don't commit, push or merge. Read `AGENTS.md`, `AGENT_MEMORY.md`, `docs/UX.md`, `docs/DESIGN.md` first. Use the `ui-ux-pro-max` and `shadcn` skills if available. If something doesn't fit the code, stop that item and report file:line.

## Problem (evidence)
Note editing is a bare `<textarea>` (`web/src/components/Reader/Reader.tsx` ≈ :160). The save mechanics around it are solid and load-bearing: exact-text `PUT /file` with a `previous` check, a 409 conflict dialog, an unsaved-changes guard and scroll memory. But the editing experience itself is zero: no highlighting, no help with our syntax, painful on a phone for a long chapter. The Memos reference ships a CodeMirror 6 markdown editor (`reference/memos/web/src/components/MemoEditor/`, MIT, read-only reference) built for this kind of writing; our web app is Memos-derived.

## Goal
Editing a real long chapter (frontmatter, `$…$`/`$$…$$` math, `[^src:…]` citations, `:::definition`/`:::example`/`:::deeper` callouts, `::visual{…}`/`::youtube{…}` lines, code fences, tables) feels genuinely good on a phone and a desktop. Port Memos' editor or build leaner; you decide, and say why.

## Rulings (orchestrator)
- **Dependencies approved**, exact-pinned (no `^`): `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, at the versions Memos uses (check `reference/memos/web/package.json`). Lazy-load the editor so the initial bundle doesn't grow, and report sizes. Anything beyond these six needs a justification in your report.
- **Affordance bar:** keyboard-first markdown editing **plus** a compact toolbar and an insert menu.
  - **Toolbar:** bold, italic, heading, list, link, inline/display math, citation, callout. On phones it sits above the keyboard and doesn't cover the text.
  - **Insert menu, for our syntax:**
    - citation, with autocomplete of the set's source ids
    - callout types
    - `::visual{…}`, with autocomplete of the set's `visuals/` files
    - YouTube moment
    - table
  - **Highlighting** of frontmatter, math, directives and citations, readable in all five themes.
  - Undo/redo, search, and soft wrap on.
  - No live-preview pane required (the reader is the preview).

## Hard constraints
- The save mechanics stay untouched in behaviour: exact-text save with the `previous` check, the 409 conflict dialog, the unsaved-changes guard and scroll memory. The editor must hand back exactly the text the learner sees: no normalising of whitespace, line endings or frontmatter on load or save.
- Never edit `reference/`. Copied code keeps its MIT notice (header comment as elsewhere in `web/`).
- Notes stay plain Markdown (D6); nothing editor-specific is written into files.

## Verify
- Tests: round-trip a real chapter byte-for-byte through load → edit nothing → save; a single-character edit produces exactly that diff; the conflict path and the unsaved guard still work; autocomplete lists the set's sources/visuals; toolbar commands insert the expected text.
- Browser check (real clicks/typing, 390×844 with an on-screen keyboard simulated by viewport resize, and 1440×900, light and dark): edit a long chapter, insert a citation and a `::visual`, save, reopen.
- Initial JS size before/after (must not grow), lazy editor chunk size. Scoped tests, `tsc --noEmit` web, web build, biome on changed files. Report: changed files, tests with counts, deviations, a 5-line log entry.
