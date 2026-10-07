# M11 — Visuals that any model gets right, proven by evals

**Goal:** a small model (e.g. `github-copilot/gpt-6-luna`) produces correct, good-looking visuals as reliably as a strong one, because the skill gives it fill-in templates and the server gives it precise, teachable errors. Prove it with an eval across all subjects and levels. Also prove that "Rewrite in teaching voice" really replaces a chapter's content.

**Trigger (2026-10-02):** the tutor's polymer sketch crashed on `theme.palette[0]` (runtime bug, fixed in `web/src/visual-runtime/runtime.js`), its text overflowed the 480-wide viewBox, and the chrome duplicated controls. Hand-written sketches from scratch are the weak point.

Read first: `skills/make-visual/` (SKILL.md + references), `shared/src/visuals/` (widget schemas), `web/src/visual-runtime/{runtime.js,sandbox.ts}`, `server/src/tree/media.ts` (`validateAgentMedia`), `server/src/agent/visual-router.ts`, `server/src/jobs/draft-job.ts` (rewrite + visual hint), D32/D33 in `docs/decisions/LOG.md`, `docs/TEACHING.md`. Live examples (read-only): `data/users/<username>/polymers/visuals/`.

## Part 1 — Skill v2: templates first, freedom last
- `SKILL.md` ≤ 120 lines, written for a small model: a strict decision table (concept → form), then "copy a template, fill the marked slots, run the checklist". Default is a **widget** (JSON, validated) or a **Vega-Lite chart**; a sketch only when no widget fits.
- `references/templates/`: complete, working, copy-ready files with `/* FILL: … */` slots only:
  - one JSON per widget (`function-plot`, `matrix-transform` incl. SVD story, `step-through`, `timeline`) with realistic example data,
  - sketch templates: `svg-labelled-diagram.html` (slider + labelled parts, safe text layout helper that wraps/shrinks text to fit the viewBox), `svg-story.html` (scenes + narration), `p5-animation.html` (looping animation with play state), `d3-chart.html` (axes with units). Each: correct header (`libs`, `poster`), `studium.mount`, theme from the `draw` argument with fallbacks, Okabe-Ito via `studium.palette`, reduced-motion respected, fits 360 px.
  - matching poster SVG templates.
- A "mistakes small models make" list with the fix for each (theme fields, text overflow, undeclared libs, `fetch`, fixed pixel sizes, missing poster attr, one concept per visual).
- Subject cheat-sheet: 2–3 concrete visual ideas per subject guide (math, science, technology, history, finance, language, practical) with which template to use.
- Register via `scripts/skill-history.mjs` + biome format of the JSON.

## Part 2 — Teachable validation
Extend agent write validation for `visuals/*.html` (in `validateAgentMedia` or a new `server/src/tree/visual-lint.ts` it calls), returning **one actionable sentence per problem**: header missing/invalid; a library used but not declared (`p5`/`d3`/`THREE` globals) or declared but unused; no `studium.mount`; network APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `import(`, `<script src`); `theme.x` used without fallback (warn); SVG without `viewBox`; poster missing. Widget JSON errors: rewrite zod messages into plain sentences with the field path and an example of a valid value. Errors for hard failures, warnings (returned to the agent like media warnings) for style issues. Tests for each rule.

## Part 3 — Visual eval (all subjects, basic → advanced)
`server/scripts/visual-eval.ts` (dev script; no app dependency added). Cases: 7 subjects × 3 levels = 21 short sections (write them in `server/scripts/visual-eval-cases.json`; each with an expected form: widget type / chart / sketch / none). For each case and each model in `--models` (default: `github-copilot/gpt-6-luna` and `openai-codex/gpt-6.1-sol` — both subscription, report fresh/output/cache tokens per provider), run the drafter role on a temp tree with a task "add the best visual for this section, or none", then score automatically:
1. **valid** — Part 2 validation passes;
2. **form** — matches or is an acceptable alternative to the expected form;
3. **renders** — headless Chrome (`/usr/bin/google-chrome` via a temporary `npx puppeteer-core` in a temp dir — don't add it to any package.json) loads the visual through the real sandbox document builder and runtime, waits for the runtime `ready`, records any `error` event/console error, checks no element overflows the stage, and saves a PNG;
4. **quality** — a judge pass (strong model, short rubric: one concept, labelled, readable at 360 px, correct science/maths, adds value over text) scoring 1–5 from the PNG + spec.
Write `docs/plans/2026-10-02-m11-visual-eval-report.md` with the table (case × model × valid/form/renders/quality), PNG paths, failures quoted, totals per model. Run once before Part 1–2 changes (baseline: current skill) and once after; report the delta. Cap: ≤ 200 model calls total.

## Part 4 — Rewrite really replaces content
On a temp copy of `data/users/<username>/hyderabad-history` (and one non-history chapter), run the real `rewrite-chapter` job end to end on one chapter that has not been rewritten. Assert and report: body text changed substantially (≥ 40 % of sentences new by a simple diff ratio, quote before/after openings), frontmatter title/order/sources kept, every `[^src:…]` id preserved and footnote text human-readable, figures/visual declarations preserved, status back to `draft` then checked by the checker, note-lint clean, a git commit by drafter/checker exists, the old text recoverable from history. If rewrite only appends or barely changes text, find why (file:line) and fix it with a regression test.

## Rules
- Read `AGENTS.md` and `AGENT_MEMORY.md`. Don't commit/push/branch; never edit `AGENT_MEMORY.md`, `.env`, `.claude/`; `data/` read-only (temp copies); keys only via `--env-file` into eval processes, never printed; only stop processes you started; `pnpm install --frozen-lockfile --prefer-offline` first; no new dependencies in package.json files; biome via `rtk proxy pnpm exec biome check <files>`.
- Scoped tests: touched test files + `server/src/tree/`; `tsc --noEmit` server/web/shared; web build.
- Write progress into the reports after each part (network cuts happen).
- Final message: per part — changed files, tests with counts, eval before/after table summary, rewrite verdict, tokens per provider (fresh/output/cache), deviations, 5-line log entry.
