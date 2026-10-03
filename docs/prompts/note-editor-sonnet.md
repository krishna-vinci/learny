# Note editor on CodeMirror 6 — precise edits (Sonnet)

Replaces the open-ended `docs/prompts/note-editor.md` for this run. Work in your own branch/worktree created from current `main`. **Don't commit, push or merge** — the orchestrator reviews and merges. Read `AGENTS.md` and `AGENT_MEMORY.md` (gotchas: base-ui `Menu.Item` uses `onClick`; real-click browser checks) first. If a step below doesn't fit the real code, stop that step and report file:line and what you saw. Don't touch anything not listed.

## Context (verified)
- The editor today is `function NoteEditor` in `web/src/components/Reader/Reader.tsx` (≈ lines 67–170). It owns: `draft`/`previous`/`conflict` state, `save(withPrevious)` with the 409 conflict banner (Reload / Overwrite), the discard `ConfirmDialog`, and the full-screen overlay `div[data-note-editor]` (`fixed inset-0 … h-[100dvh]`). The only editing surface is the `<textarea value={draft} onChange={(e) => setDraft(e.target.value)} …/>` at ≈ line 160.
- `draft` starts as `file.raw` (exact file bytes, frontmatter included) and is saved verbatim via `PUT /file` with `previous`.
- Memos' editor (MIT, read-only reference): `reference/memos/web/src/components/MemoEditor/Editor/` — useful generic pieces: `formatting.ts` (+ types from `../formatting/commands.ts`, `../types/editorController.ts`), `listIndent.ts`, `headingDecorations.ts`, `theme.ts`, keymaps in `extensions.ts`. Memo-specific pieces to **leave out**: tags, mentions, upload anchors, audio, focus mode, `memoMarkdownExtensions`.
- APIs: `api.sets.sources(set)` → `SourceSummary[]` (id, title) in `web/src/api/client.ts`. There is **no** endpoint listing a set's `visuals/` files (step 1 adds one).
- Theme tokens: CSS variables in `web/src/index.css` (`--background`, `--foreground`, `--muted-foreground`, `--primary`, `--border`, `--font-mono`; five themes + dark).

## Steps

### 1. Server: list a set's visuals (tiny, read-only)
- `server/src/routes/sets.ts`: add `GET /:set/visuals` → `{ files: string[] }`, the names of files directly in `<set>/visuals/` ending `.json` or `.html` (sorted; no contents; empty list if the folder is missing). Follow the existing route pattern (`setExists` → 404, `resolveInRoot`/realpath confinement, ignore symlinks).
- Test in `server/src/routes/sets.test.ts`: lists files, empty folder → `[]`, unknown set → 404, a symlink inside `visuals/` is not listed.
- `web/src/api/client.ts`: `sets.visuals(set): Promise<{ files: string[] }>` next to `sources`.

### 2. Dependencies (`web/package.json`, exact pins, no `^`)
`@codemirror/state@6.7.2`, `@codemirror/view@6.43.10`, `@codemirror/language@6.12.4`, `@codemirror/commands@6.11.0`, `@codemirror/lang-markdown@6.5.2`, `@codemirror/autocomplete@6.20.3`, and **`@codemirror/search@6.7.2`** (approved for in-editor find; CodeMirror virtualises lines so the browser's find misses off-screen text). `pnpm install` and commit nothing else to the lockfile beyond these and their transitive deps.

### 3. New folder `web/src/components/NoteEditor/`
Every file ported from Memos starts with the repo's notice style: `// Adapted from Memos (MIT) — https://github.com/usememos/memos` + one line on what changed.
- `formatting.ts` — port Memos `formatting.ts` + the minimal types it needs from `commands.ts`/`editorController.ts` + `listIndent.ts`. Keep: bold, italic, code, code block, heading 1–3, bullet/ordered/task list, list indent/outdent. Add Studium commands: `inlineMath` (wrap selection in `$…$`), `displayMath` (insert `\n$$\n…\n$$\n` on its own lines), `citation` (insert `[^src:` and open autocomplete), `callout(name)` (`:::definition{title="…"}` … `:::` around selection or empty), `visual` (insert `::visual{src="../visuals/" title=""}` on its own line at the cursor's line end and open autocomplete), `youtube` (`::youtube{src="" start=0}`), `table` (2×2 GFM table).
- `syntax.ts` — a `ViewPlugin` with mark decorations (CSS classes only, no widgets) for: the leading frontmatter block (`---` … `---` at doc start), `$…$` and `$$…$$` math, `[^src:…]` citations, directive lines (`^:::` and `^::(visual|youtube|artifact)\{…\}`). Recompute only for visible ranges (Memos `viewportDecorations.ts` shows the pattern). Plus Memos `headingDecorations.ts` ported.
- `completions.ts` — an `autocompletion` source with three triggers, each a pure function tested separately: after `[^src:` → set source ids (label = id, detail = title); inside `::visual{src="../visuals/` → files from `api.sets.visuals`; after `:::` at line start → `definition`, `theorem`, `example`, `deeper`. Data is fetched once per editor open (TanStack Query hooks are fine) and passed in.
- `theme.ts` — `EditorView.theme` using the CSS variables only (no literal colours): background/foreground, selection, cursor, gutters off, `font-family: var(--font-mono)`, line-height 1.6, **font-size 16px on screens < 768px** (prevents iOS zoom on focus) and 14px above; classes for the decorations in `syntax.ts` (muted frontmatter, primary-tinted math/citations/directives, headings bolder). Readable in all five themes + dark.
- `extensions.ts` — assemble: `markdown()`, `history()`, keymaps (`defaultKeymap`, `historyKeymap`, `searchKeymap`, Memos' formatting keys incl. Mod-b/Mod-i/Mod-e, Tab/Shift-Tab list indent, Escape blurs), `search({ top: true })`, `EditorView.lineWrapping`, `autocompletion({ override: [studiumCompletions] })`, `syntax.ts`, `theme.ts`. **No** `placeholder`, upload, tag or mention extensions.
- `CodeMirrorNoteEditor.tsx` — `export default function CodeMirrorNoteEditor({ set, value, onChange }: { set: string; value: string; onChange: (text: string) => void })`:
  - Creates one `EditorView` on mount with `doc: value`; `updateListener` calls `onChange(view.state.doc.toString())` only when `docChanged`.
  - **Byte-exact text**: CodeMirror normalises `\r\n` to `\n`. If `value` contains `\r`, **don't mount CodeMirror**: render the existing plain textarea instead (same classes as today) and show a one-line muted note "This note uses Windows line endings; using the plain editor." This keeps saves byte-exact.
  - If `value` changes from outside while mounted (conflict "Overwrite" path keeps `draft`; nothing else changes it), dispatch a full replace only when it differs from the current doc.
  - Destroys the view on unmount.
  - Renders the toolbar (below) and the editor in a flex column filling the overlay.
- `Toolbar.tsx` — one row, horizontal scroll if needed, 44px targets on phones, `aria-label` on icon buttons, lucide icons: Bold, Italic, Heading (menu H1–H3), List (menu bullet/ordered/task), Link, Math (menu inline/display), Citation, Callout (menu: definition, theorem, example, deeper), Insert (menu: Visual, YouTube moment, Table). Use the existing `@/components/ui/dropdown-menu` (base-ui; items use `onClick`). Buttons call the `formatting.ts` commands on the view and refocus it.
  - **Phones:** the toolbar sits at the **bottom** of the overlay, just above the on-screen keyboard: listen to `window.visualViewport` `resize`/`scroll` and set a CSS variable with the keyboard inset (`innerHeight - visualViewport.height - visualViewport.offsetTop`, min 0) used as the toolbar's bottom offset; plus `env(safe-area-inset-bottom)`. Desktop (≥ 768px): toolbar at the top under the header row.

### 4. Wire it in `Reader.tsx` (only this change there)
- Replace **only** the `<textarea …/>` element in `NoteEditor` with a lazy-loaded editor:
  `const CodeMirrorNoteEditor = lazy(() => import("@/components/NoteEditor/CodeMirrorNoteEditor"));`
  `<Suspense fallback={<the existing textarea, unchanged>}><CodeMirrorNoteEditor set={set} value={draft} onChange={setDraft} /></Suspense>`
  The fallback keeps editing possible while the chunk loads (same `draft` state).
- Keep everything else in `NoteEditor` exactly as is: save/conflict/discard logic, header buttons, overlay classes, the `data-note-editor` attribute, safe-area padding.
- Remove nothing else; update the `NoteEditor` doc comment to say CodeMirror (with textarea fallback).

## Tests
- `web/src/components/NoteEditor/completions.test.ts` — the three triggers (match/no-match positions, ranking by prefix).
- `web/src/components/NoteEditor/formatting.test.ts` — each Studium command on an `EditorState` (inline/display math, citation, callout around a selection, visual line placement, table) and bold/italic toggles.
- `web/src/components/NoteEditor/CodeMirrorNoteEditor.test.tsx` — mount with a real chapter-like text (frontmatter, math, citations, `::visual`, a fenced code block, trailing newline) → `onChange` not called on mount and the doc equals the input exactly; one typed character → `onChange` gets exactly input + that char; text containing `\r\n` renders the textarea fallback.
- Existing Reader tests that cover editing/saving/conflicts must still pass unchanged (find them with `rtk proxy grep -rn "Editing\|Overwrite\|Discard" web/src --include=*.test.tsx`).
- Server test from step 1.

## Verify
- `pnpm --filter @studium/web exec vitest run src/components/NoteEditor src/components/Reader` + the Reader editing tests found above; `pnpm --filter @studium/server exec vitest run src/routes/sets.test.ts`.
- `pnpm --filter @studium/web exec tsc --noEmit`, `pnpm --filter @studium/server exec tsc --noEmit`, `pnpm --filter @studium/web build` — report the initial JS size (must not grow) and the lazy editor chunk size (gzip).
- `rtk proxy pnpm exec biome check <changed files>`.
- Browser (temp server on a copy of `examples/sample-set`, admin from env, `STUDIUM_FAUX=1`, your own port; real clicks and typing): open a math chapter → Edit → type, use Bold, insert a citation via autocomplete, insert a `::visual` via the Insert menu, Save → the reader shows the change; edit → Cancel → discard dialog; 390×844 with the viewport height reduced to ~500px to mimic the keyboard (toolbar stays visible above it, no horizontal page scroll) and 1440×900; light, dark and one more theme. Stop only the server you started.

## Done when
All steps implemented, tests and checks pass, the report lists: changed files, tests with pass/fail counts, bundle sizes, browser results, deviations, and a 5-line `AGENT_MEMORY.md` log entry (the orchestrator adds it).
