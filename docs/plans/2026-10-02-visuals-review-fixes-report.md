# Visuals review fixes implementation report — 2026-10-02

Implemented locally on `codex/visuals-fixes` from the verified prompt `docs/prompts/visuals-review-fixes.md`. No commits, pushes, branches, sub-agents, orchestration skills, new dependencies or full-suite runs. `AGENT_MEMORY.md`, `.env*`, `.claude/`, live `data/` untouched. The temporary server (own port 3197, temp data dir, admin from env, `STUDIUM_FAUX=1`) was stopped via its saved PID; evidence remains in `/tmp/studium-vfix-8VZ4` (log, seeded tree, pwhash).

## Per-item changes

1. **Component tests for the new iframe path** — new `web/src/components/Reader/SketchBlock.test.tsx` (4 tests) and `VisualBlock.test.tsx` (3 tests), mirroring the legacy artifact test pattern: exact `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"` on the mounted iframe, srcdoc starting with `sketchCsp(location.origin)`, exactly the manifest-declared library + `studium-runtime` as script srcs, no iframe until the runtime document is built, manifest-fetch failure → connection copy → retry refetches and mounts, malformed header → content copy with no retry, foreign `postMessage` sources ignored, genuine runtime error → Restart remounts, and a widget JSON rendering `WidgetBlock` with no iframe. `location.origin` was not stubbed — expectations are computed from the real jsdom origin (same guarantee).
2. **Skill drift** — `skills/note-authoring/SKILL.md` (the review's line 97) now loads `make-visual`, creates in `visuals/`, attaches via `::visual`; the three `draft-chapter/references/subject-*.md` lines now say "a `make-visual` widget (`::visual`)". `media-authoring` untouched (legacy compatibility is its job). `node scripts/skill-history.mjs` ran; `skills/.defaults-history.json` formatted and updated (4 new hashes).
3. **Full screen without restart** — new shared `web/src/components/Reader/VisualFrame.tsx`: `useVisualFullscreen()` (CSS-only overlay classes on the same element tree, body scroll lock, Escape + exit button, focus to exit and back). `ArtifactBlock` lost its `createPortal` (single tree now); `VisualBlock` gained the header button and passes `full` into `SketchBlock`/`WidgetBlock` for canvas sizing, so widgets and sketches get the same affordance. Ancestor scan for `position: fixed` traps (`transform`/`filter`/`contain`/`will-change`/`backdrop-filter`): none in the reader ancestry (the only `backdrop-blur` in the app is the mobile header bar, a sibling, not an ancestor) — CSS fixed is safe; native Fullscreen API fallback not needed.
4. **SketchBlock/VisualBlock error split** — three failure kinds with distinct copy and affordances: connection ("This visual needs a connection." + Try again), content ("This visual has a problem and can't be shown." + collapsible ≤300-char detail, no retry), runtime ("This visual stopped with an error." + detail + Restart remounting the frame). `VisualBlock` distinguishes invalid path/oversize/non-text/`parseWidget` failures (content) from fetch/HTTP failures (connection). The shadowed `document` local in `SketchBlock` is gone (srcdoc state built inside the manifest effect); no iframe mounts before the document exists, so the spurious empty-frame `onLoad` postMessage is gone.
5. **Offline runtime** — Workbox runtime rules added in `web/vite.config.ts`: `manifest.json` NetworkFirst (3 s, 1 entry) and `/visual-runtime/*.js` CacheFirst (12 entries, 90 days); precache exclusion kept. Measured in Chromium (below). `docs/UI.md` documents the measured behaviour, replacing the old "offline uncached visuals explain that a connection is needed" wording.
6. **Misplaced declarations** — `shared/src/chapter-visuals.ts`: the collector now tracks `:::` callout containers (declarations inside them stay prose) and exports `misplacedVisualDeclarations()` (quote/list/deep-indent/extra-colons/in-container detection, fence-aware); re-exported via `media.ts`. Agent note writes (all four write paths in `server/src/tree/edit.ts`, holder ≠ user) are rejected with the exact prompt message when the final text contains one; learner saves never rejected (whole-document validation, like the media checks — an agent edit to a file the learner "broke" is also rejected; documented in the test). The reader renders misplaced `::visual`/`::artifact` in prose as a muted "Visual not shown: move this declaration to its own line at the chapter end." line (`remarkStudium.ts` + `MarkdownView.tsx`); chat keeps plain links for resolvable sources and the unavailable text otherwise.

## Tests and checks

| Exact command | Result |
| --- | --- |
| `pnpm --filter @studium/web exec vitest run src/components/Reader src/visual-runtime` | 59 passed, 1 skipped (opt-in audit), 0 failed |
| `pnpm --filter @studium/shared exec vitest run src/media.test.ts src/visuals` | 55 passed, 0 failed |
| `pnpm --filter @studium/server exec vitest run src/tree/ src/agent/note-lint.test.ts src/agent/tools.test.ts` | 98 passed, 0 failed |
| `pnpm --filter @studium/shared exec tsc --noEmit` / `@studium/server` / `@studium/web` | all pass, 0 errors |
| `pnpm --filter @studium/web build` (with prebuild runtime hook) | pass; SW + runtime manifest generated |
| `rtk proxy pnpm exec biome check <17 changed files>` | pass after `--write` (one real lint catch: my own `escape` shadow in VisualFrame.tsx, renamed) |
| `node scripts/skill-history.mjs` + biome format | pass, history updated |

## Browser checks (real server on 127.0.0.1:3197, real Chrome via CDP, real clicks)

Temp tree seeded from `examples/sample-set` plus two probe visuals (`broken.html` — no `studium-visual` header; `boom.html` — header + throwing script) appended to `notes/01-vectors.md`.

- **Full screen never restarts**: tagged the playing sketch iframe with a dataset probe, toggled full screen — the exact same element (probe intact, `sandbox`/`referrerpolicy` unchanged) under `fixed inset-0` overlay classes; exit by Escape and by button both restore `min-w-0` with the same element; body scroll locks/restores; focus lands on "Exit full screen" and restores. Widget full screen: SVG renders, no iframe ever, exits cleanly. Verified at 1440×900 (light) and 390×844 (light + dark; overlay uses the dark `bg-background` token, covers the full viewport, no horizontal overflow).
- **Error states**: broken sketch → "This visual has a problem and can't be shown." with Details exposing "Sketch needs an application/json studium-visual header"; throwing sketch → "This visual stopped with an error." with Details exposing "Uncaught Error: deliberate failure" + Restart, and Restart cycles (fresh frame → throws again → error card). Connection copy verified in component tests (the SW manifest cache now masks it in-browser once warmed).
- **Offline (measured, DevTools network emulation, after online warm-up + reload)**: page shell from precache; widget fully playable; all note-file reads and the sketch `manifest.json` served from caches (transferSize 0, HTTP 200 — the new SW rule works); **but** the library scripts requested inside the opaque-origin srcdoc frame went to the network and failed (`net::ERR_INTERNET_DISCONNECTED`): no service worker controls those loads and the HTTP cache did not answer under emulation, so sketches mount a blank frame offline (no error card — the runtime that would report the failure is exactly what failed to load). Documented as measured in `docs/UI.md`; back online, everything recovers without reload-to-fix beyond the normal re-fetch.

## Deviations / notes for review

- The review's fullscreen finding said the portal "unmounts and recreates" (React tree positions) rather than DOM-reparenting; either way the frame reloaded — the fix is the same single-tree CSS overlay, and the browser probe proves element identity.
- Collector semantics changed deliberately per the prompt's test list: declarations inside `:::example`-style containers are no longer attachments (they were collected before this change); two-space indents still are.
- Whole-document rejection means an agent cannot edit a note that already contains a learner-authored misplaced declaration until the learner fixes it — asserted explicitly in `server/src/tree/edit.test.ts`; flagged in case the orchestrator prefers edit-scope-only validation.
- The `.js` CacheFirst rule is kept although this Chromium run shows frame loads bypassing the SW — it covers SW-controlled contexts and costs nothing; the honest limitation is documented.
- WebKit/iPhone not available on this host; all browser checks ran in Chrome at 390×844 and 1440×900, light and dark.

## Five-line memory log

```text
2026-10-02 · visuals-review-fixes (ZCode/GLM-5.3): D31/D32 defect pass on codex/visuals-fixes, prompt docs/prompts/visuals-review-fixes.md.
VisualFrame.tsx useVisualFullscreen = CSS-only overlay for artifact/visual/sketch/widget; no portal, frame never reloads (proven by dataset-probe identity in Chrome).
Sketch/Visual failures split connection/content/runtime with retry/detail/restart; no iframe before srcdoc; skills teach ::visual/make-visual only; defaults history bumped.
chapter-visuals: container-aware collector + misplacedVisualDeclarations; agent note writes with misplaced declarations rejected (whole-document; learner saves never); reader shows "Visual not shown" marker.
PWA: manifest NetworkFirst + visual .js CacheFirst; measured offline: widgets yes, sketch manifest cached, frame lib loads bypass SW+HTTP cache under emulation → blank sketch offline (documented in UI.md).
```
