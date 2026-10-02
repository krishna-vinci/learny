# M9 implementation report

Single-agent implementation on `codex/m9`, no commits/pushes/branch changes. Dependencies installed first with `pnpm install --frozen-lockfile --prefer-offline`. Protected paths and Pi/patches untouched. Context7 public MCP used via the installed SDK (no named Context7 tool was exposed).

## Part 1 — Runtime and sandbox plumbing (complete)

Changed files:
- `shared/src/media.ts`, `media.test.ts`: collect `::visual`, classify widget/sketch, confine references and retain legacy artifact handling.
- `shared/src/visuals/{common,expression,function-plot,matrix-transform,step-through,timeline,index,sketch}.ts`: strict widget/header schemas and safe expression validation for agent writes (geometry follows in Part 2).
- `server/src/tree/{paths,media}.ts`, their tests: scoped visuals writes, 300 KB cap, widget validation and required sketch posters; SVG security retained.
- `server/src/agent/roles.ts`, `jobs/draft-job.ts`, `routes/sets.ts`: visuals write allowance and raw JSON/HTML/image reads.
- `web/src/visual-runtime/{sandbox.ts,sandbox.test.ts,runtime.js}`: exact CSP, declared-only libraries, message validation, story/controls/theme runtime.
- `web/scripts/build-visual-runtime.mjs`, `web/public/visual-runtime/README.md`, `web/vite.config.ts`, `.gitignore`: generated content-hashed static libraries, build/dev hooks, PWA exclusion.
- `server/src/http/visual-runtime.ts`, its test, `server/src/server.ts`: public static allowlist, opaque-origin CORS, immutable hashed files, no session requirement.
- `shared/package.json`, `web/package.json`, `pnpm-lock.yaml`: approved exact dependencies and exports/build hooks.

Tests:
- `pnpm --filter @studium/server exec vitest run src/tree/ src/http/visual-runtime.test.ts src/agent/roles.test.ts src/routes/sets.test.ts`: **109 passed, 1 failed**. Unrelated existing fixture mismatch at `server/src/agent/roles.test.ts:284`: expects checked, copied sample notes are accepted. Left untouched.
- `pnpm --filter @studium/server exec vitest run src/tree/paths.test.ts -t 'allows visuals'`: 1 passed.
- `pnpm --filter @studium/shared exec vitest run src/media.test.ts`: **46 passed**.
- `pnpm --filter @studium/web exec vitest run src/visual-runtime/sandbox.test.ts src/components/Reader/ChapterVisuals.test.tsx`: **5 passed**.
- `pnpm --filter @studium/{shared,server} exec tsc --noEmit` (run separately): both passed.
- `pnpm --filter @studium/web exec node scripts/build-visual-runtime.mjs`: passed.
- `node /tmp/m9-runtime-browser.mjs`: **5 passed** in Chrome: all three libraries load in scripts-only opaque iframe; fetch is blocked and the CSP console message confirms `connect-src 'none'`. Temporary library server closed by the script.

Bundle sizes: baseline initial entry **404.59 KB / 127.19 KB gzip**. Public runtime raw bytes: p5 990638, D3 280602, Three 736643, Studium runtime 4910. These are served separately, declared-only, never imported into the app entry or PWA precache. Final entry comparison in Part 4.

Dependency justification: exact `p5@2.3.4`, `d3@7.9.0`, `three@0.186.1` per V9; shared `d3@7.9.0`, `expr-eval-fork@3.0.3`. Original expr-eval 2.0.2 is vulnerable per [GHSA-jc85-fpwf-qm7x](https://github.com/advisories/GHSA-jc85-fpwf-qm7x), [GHSA-8gw3-rxh4-v6jx](https://github.com/advisories/GHSA-8gw3-rxh4-v6jx), and [GHSA-q9v2-7m5w-4693](https://github.com/advisories/GHSA-q9v2-7m5w-4693); fork 3.0.3 contains the published fixes. Never use compilation/toJSFunction; numeric-only variables, lexical allowlist and interpreter evaluation.

Deviations/evidence: p5's `lib/p5.min.js` is already a browser global bundle with no default export, so it is copied and content-hashed instead of rebundled. Vite library build returns an array, handled by the builder. Context7 does not index expr-eval-fork; queried upstream parser docs, verified the fork locally. Both latest and 4.20.0 shadcn CLI reject existing `web/components.json`; retain existing UI kit and its Base UI APIs. No existing configuration changed to accommodate the CLI. App browser matrix follows Part 3.

## Part 2 — Widget library (complete)

Changed files:
- `shared/src/visuals/{function-plot,matrix-transform,step-through,timeline}.ts`: pure D3 scale/shape/math scene layouts; plot parameters/points/units, matrix interpolation/grid/circle/basis/SVD, trace arrays/graphs/boxes, BCE/ISO timeline and zoom/event selection.
- `shared/src/visuals/{scene,index,expression}.ts`: common axis geometry, XML-safe static SVG serialization, widget dispatch/implicit scenes and interpreter-only arithmetic allowlist.
- `shared/src/visuals/widgets.test.ts`: schema rejection and key geometry, re-layout, static output and expression fuzz cases.
- `web/src/components/Reader/{WidgetBlock,StoryControls}.tsx`, `WidgetBlock.test.tsx`: thin SVG React rendering, sliders, shared scene chrome, keyboard navigation and animation controls.
- `shared/package.json`, `pnpm-lock.yaml`: exact `@types/d3@7.4.3`, compile-time types for the V9 library, no runtime dependency beyond V9.

Tests:
- `pnpm --filter @studium/shared exec vitest run src/visuals/widgets.test.ts`: **6 passed** (including >100 hostile expression cases).
- `pnpm --filter @studium/web exec vitest run src/components/Reader/WidgetBlock.test.tsx`: **2 passed**.
- `pnpm --filter @studium/shared exec tsc --noEmit`, `pnpm --filter @studium/web exec tsc --noEmit`, `pnpm --filter @studium/server exec tsc --noEmit`: passed individually.
- `rtk proxy pnpm exec biome check --write shared/src/visuals web/src/components/Reader/WidgetBlock.tsx web/src/components/Reader/WidgetBlock.test.tsx web/src/components/Reader/StoryControls.tsx`: formatting applied; final changed-file check recorded in Part 4.

Browser: widget interactions join the app matrix in Part 3, after integration. Bundle: layouts imported only by the lazy Visuals panel; entry comparison in Part 4. Dependency justification: D3 type definitions are development-only support for V9's D3 dependency. Deviations: one shared React SVG renderer/controls component covers all four widgets, avoiding four copies of the same thin wrapper. Explicit story schemas land before geometry because agent-write validation is required in Part 1. Corrected a floating-point assertion to use tolerance and kept early ISO years independent of JavaScript's Date.UTC 1900 offset.

## Part 3 — Visuals view (complete)

Changed files:
- `web/src/components/Reader/{ChapterVisuals,Reader}.tsx`: lazy-load new visual types/panel, keep legacy Run behavior and preserve D31 tab unmounting.
- `web/src/components/Reader/{VisualBlock,SketchBlock}.tsx`: bounded/cancellable loading, canvas-sized skeletons, retry states, scripts-only frame, validated ready/error events and parent theme/playback messages.
- `web/src/visual-runtime/{playback,theme}.ts`, `playback.test.tsx`: half-visible autoplay, page-hidden/offscreen pause, reduced-motion detection, one most-visible sketch on phones, mapped Okabe-Ito palette and app font/theme inheritance.
- `web/src/components/Reader/WidgetBlock.tsx`, `web/src/visual-runtime/runtime.js`: lifecycle/keyboard/initialization fixes found during integration; runtime initializes before sketch document listeners.
- `web/vite.config.ts`: new Visuals dependency preloading deferred until opening the panel.

Tests:
- `pnpm --filter @studium/web exec vitest run src/visual-runtime/playback.test.tsx src/visual-runtime/sandbox.test.ts src/components/Reader/WidgetBlock.test.tsx src/components/Reader/ChapterVisuals.test.tsx`: **10 passed**.
- `pnpm --filter @studium/web exec tsc --noEmit`: passed.
- `pnpm --filter @studium/web build`: passed; widget code is a separate lazy `VisualBlock` chunk (**48.39 KB / 16.03 KB gzip**), runtime libraries absent from PWA precache.
- `node /tmp/m9-app-browser.mjs`: **115 passed, 0 failed**; real clicks/keyboard at 390×844 and 1440×900, light/dark/sepia (18 checks per combination), reduced-motion and unauthenticated runtime reads. Autoplay, offscreen pause, story buttons/arrows, slider geometry changes, theme recoloring, exact sandbox, blocked fetch/CSP console, cookie-free library requests, no external requests and Reading unmount all verified. Screenshots and result JSON in `/tmp/studium-m9/`.

Bundle: no libraries in initial JS; final bundle comparison in Part 4. Dependencies: none beyond Part 2. Deviations: runtime DOM initialization listens on `document`, before authored document listeners (a `window` listener ran too late for script-only documents). Browser assertions wait for React's committed unmount after the real tab click. Shadcn CLI remained unavailable for this repo's existing configuration; reused its installed Button/Skeleton/Empty components and native range controls. Test server is an owned foreground process (PID saved in `/tmp/studium-m9/server.pid`), env-created admin, faux model, temporary sample-set copy on port 3198. It will be stopped by that PID after final verification.

## Part 4 — Book, skill and docs (complete)

Changed files:
- `server/src/jobs/book-media.ts`, `book-job.test.ts`: shared-layout widget SVGs, default plus narrated story scenes, declarative sketch-header poster metadata, scene caps/first-last pointers, static fallback and legacy HTML unread.
- `server/src/agent/visual-router.ts`, its test, `shared/src/schemas.ts`: null router interface and default `visuals.router: off`, without model wiring.
- `skills/make-visual/SKILL.md` (78 lines), `references/{widgets,runtime,p5,d3,three}.md`: widget catalog/full specs, runtime/API/version-pinned cheat sheets, quality/poster/router rules; one interactive source of truth.
- `skills/{media-authoring,draft-chapter,explain,evolve-note}/SKILL.md`, `skills/.defaults-history.json`: route interactive authoring to make-visual and register current defaults.
- `server/src/agent/roles.ts`, `jobs/draft-job.ts`, `agent/media-warnings.ts`: register make-visual for Tutor/Drafter and accept/report visuals references in chapter/revision guidance.
- `server/src/tree/init.test.ts`: new default skill in the existing skeleton expectation.
- `server/src/routes/sets.ts`: additional canonical confinement for raw visuals reads.
- `docs/decisions/LOG.md`, `docs/{STUDY_TREE,AGENT_ROLES,UI}.md`: D32, folder/scope/UI/book/router contracts and explicit deferrals.
- `examples/sample-set/linear-algebra/notes/01-vectors.md`, `visuals/{slope.json,stretch.html,stretch-one.svg,stretch-two.svg}`: one widget plus one story sketch and two labelled static scene posters, only in examples.
- `shared/src/{chapter-visuals,media-paths}.ts`, `media.ts`, `shared/package.json`, `web/src/components/Reader/Reader.tsx`: preserve public media exports while isolating chapter collection from common media paths; no runtime import cycle.
- `shared/src/visuals/{index,matrix-transform,step-through,timeline,widgets.test}.ts`: stricter numeric/range story states and small-process/category bounds; equal axis units preserve the identity unit circle; cumulative SVD transitions start at the preceding stage.
- `web/src/components/Reader/WidgetBlock.tsx`, `web/src/visual-runtime/runtime.js`: timeline pan/selected-event card, keyboard navigation from scene buttons, reduced-motion manual scene persistence.
- `web/vite.config.ts`: group only statically required modules (`$initial`) to preserve compression without bringing lazy widget/runtime libraries into startup.

Tests and verification:
- `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts src/agent/visual-router.test.ts`: **19 passed** before the example fixtures landed.
- After examples, existing media-numbering and skill-list assertions needed updating. `pnpm --filter @studium/server exec vitest run src/tree/init.test.ts src/jobs/book-job.test.ts`: **26 passed** after corrections.
- Final scoped server command: `pnpm --filter @studium/server exec vitest run src/tree/ src/http/visual-runtime.test.ts src/jobs/book-job.test.ts src/jobs/draft-job.test.ts src/agent/tools.test.ts src/agent/visual-router.test.ts src/routes/sets.test.ts`: **147 passed, 0 failed**, 15 files. Includes the whole high-risk tree directory.
- Final shared command: `pnpm --filter @studium/shared exec vitest run src/visuals/widgets.test.ts src/media.test.ts`: **53 passed, 0 failed**, 2 files.
- Final web command: `pnpm --filter @studium/web exec vitest run src/visual-runtime/ src/components/Reader/WidgetBlock.test.tsx src/components/Reader/ChapterVisuals.test.tsx src/components/Reader/Reader.test.tsx`: **47 passed, 0 failed**, 5 files.
- `pnpm --filter @studium/server exec tsc --noEmit`, `pnpm --filter @studium/web exec tsc --noEmit`, `pnpm --filter @studium/shared exec tsc --noEmit`: all pass.
- `node scripts/skill-history.mjs`: current defaults registered; JSON formatted with Biome.
- `python3 /tmp/m9-check-biome.py`: executes `rtk proxy pnpm exec biome check` on every changed supported code/config file (exact file manifest below); **passes, no fixes needed**.
- `git diff --check`: passes.
- `pnpm --filter @studium/web build`: passes. `visual-runtime/**` absent from the generated PWA precache; runtime fallback excluded.
- `pnpm audit --json`: exits nonzero for **15 pre-existing undici advisories** (3 low, 7 moderate, 5 high), exactly unchanged from baseline; no new package advisories. Original expr-eval advisories and parser choice are linked in Part 1.
- `pnpm --filter @studium/server exec tsx /tmp/m9-book.mts`: real **9-page** sample-set PDF compiled successfully with Pandoc/Typst, using a temp sample-tree copy. Preserved SVGs and Markdown in `/tmp/studium-m9/book-inspect/`; PDF in `/tmp/studium-m9/book-study/linear-algebra/.cache/book/linear-algebra.pdf`.
- `pdftotext -layout … /tmp/studium-m9/book.txt` and `pdftoppm -f 4/5/6 -l 4/5/6 -scale-to 1400 -png -singlefile …`: visually inspected pages 4–6. Default/widget scene geometry, captioned slope change and both labelled vector posters are present and readable. HTML never executes in compilation.
- `node /tmp/m9-app-browser.mjs`: final sample examples and final build, **116 real-click/keyboard checks, 0 failures**, Chrome at both requested sizes × light/dark/sepia plus reduced-motion/manual navigation and anonymous library reads. Browser result JSON/screenshots in `/tmp/studium-m9/`. Part 1's separate opaque-sandbox library/CSP check adds 5 passing checks.

Final bundle accounting: **all JavaScript initially loaded by index.html**, including entry and modulepreloads, is **281.40 KB gzip before → 273.40 KB after** (8.00 KB smaller). Widget/Sketch `VisualBlock` is **50.70 KB / 16.68 KB gzip**, separately lazy. Public library bytes remain p5 990638, D3 280602, Three 736643; final Studium runtime 4958 bytes. The final entry is **873.24 KB / 272.98 KB gzip**, because existing startup modules were combined for compression; comparing only this entry with the old 404.59/127.19 entry would omit the old initial modulepreloads. Earlier part entries are historical measurements; this full startup measurement is the final budget check.

Dependency justification: all runtime packages follow V9's exact pins; patched evaluator plus numeric-only interpreter policy; development-only D3 types. No Pi/patch/version changes, no other runtime dependencies, no provider/model calls or paid smoke tests.

Deviations and open questions:
- The original existing tutor test `server/src/agent/roles.test.ts:284` still expects “checked” for accepted sample notes (Part 1). It is unrelated and was not repaired or widened into the final scoped suite.
- Context7 lacks an expr-eval-fork entry; upstream API docs and installed fork behavior were used. Shadcn CLI rejects the existing repository config; existing Base UI components were retained.
- Shared media helpers were split without changing their public exports to avoid initial Reader/Visuals coupling. The build now explicitly groups static startup modules for compression; no lazy visual/library code is included.
- New sketch books read only the JSON header to locate authored posters; legacy artifact books still never read HTML. No browser/headless capture is used for books.
- No WebKit/iPhone check on this host; Chrome checks cover sizes, input, themes and reduced motion. Scroll-synced stories, headless captures and Mermaid SVG remain explicit deferrals.
- No source, data, .env, .claude, AGENT_MEMORY or live-service mutation. The temporary app workspace is separate from live data; process cleanup is recorded below.

Final cleanup: sent SIGTERM only to saved, command/cwd-verified owned test-server PID **1838390**; it exited. No live process was stopped. Final `pnpm --filter @studium/server exec vitest run src/tree/media.test.ts`: **2 passed** after keeping the new JSON cap specific to visuals (legacy asset metadata behavior preserved).

### Exact Biome file arguments

The final check used `rtk proxy pnpm exec biome check` with these arguments (52 paths, 49 checked by Biome; unsupported fixture HTML/config formats are ignored):

```text
examples/sample-set/linear-algebra/visuals/slope.json
examples/sample-set/linear-algebra/visuals/stretch.html
pnpm-lock.yaml
server/src/agent/media-warnings.ts
server/src/agent/roles.ts
server/src/agent/visual-router.test.ts
server/src/agent/visual-router.ts
server/src/http/visual-runtime.test.ts
server/src/http/visual-runtime.ts
server/src/jobs/book-job.test.ts
server/src/jobs/book-media.ts
server/src/jobs/draft-job.ts
server/src/routes/sets.ts
server/src/server.ts
server/src/tree/init.test.ts
server/src/tree/media.test.ts
server/src/tree/media.ts
server/src/tree/paths.test.ts
server/src/tree/paths.ts
shared/package.json
shared/src/chapter-visuals.ts
shared/src/media-paths.ts
shared/src/media.test.ts
shared/src/media.ts
shared/src/schemas.ts
shared/src/visuals/common.ts
shared/src/visuals/expression.ts
shared/src/visuals/function-plot.ts
shared/src/visuals/index.ts
shared/src/visuals/matrix-transform.ts
shared/src/visuals/scene.ts
shared/src/visuals/sketch.ts
shared/src/visuals/step-through.ts
shared/src/visuals/timeline.ts
shared/src/visuals/widgets.test.ts
skills/.defaults-history.json
web/package.json
web/scripts/build-visual-runtime.mjs
web/src/components/Reader/ChapterVisuals.tsx
web/src/components/Reader/Reader.tsx
web/src/components/Reader/SketchBlock.tsx
web/src/components/Reader/StoryControls.tsx
web/src/components/Reader/VisualBlock.tsx
web/src/components/Reader/WidgetBlock.test.tsx
web/src/components/Reader/WidgetBlock.tsx
web/src/visual-runtime/playback.test.tsx
web/src/visual-runtime/playback.ts
web/src/visual-runtime/runtime.js
web/src/visual-runtime/sandbox.test.ts
web/src/visual-runtime/sandbox.ts
web/src/visual-runtime/theme.ts
web/vite.config.ts
```

## Five-line log for AGENT_MEMORY.md

```text
2026-10-02 · M9: all four parts implemented on codex/m9; uncommitted, no delegation or protected-path edits.
Added visuals/ directives, exact-pinned local runtimes, strict opaque sandbox, autoplay/theme/stories and four pure SVG widgets.
Book renders default/scene SVGs or authored sketch posters; make-visual/docs/D32/default hashes and sample examples complete; router remains off/null.
Final scoped checks: 147 server + 53 shared + 47 web pass, types/Biome/build/PDF pass, 116 app browser + 5 sandbox checks; initial JS 281.40→273.40 KB gzip.
Open: unrelated roles.test.ts:284 accepted-vs-checked fixture, 15 existing undici audit advisories, WebKit untested; owned temp server stopped.
```
