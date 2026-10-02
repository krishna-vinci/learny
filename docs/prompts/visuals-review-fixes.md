# Visuals review fixes (local, GPT-6.1 Sol)

You are the IMPLEMENTER in `/home/krishna/learny-worktrees/visuals-fixes` on branch `codex/visuals-fixes`. Do not load orchestration skills and do not spawn sub-agents.

Context: the chapter Visuals system (D29 media, D31 Visuals tab, D32 widgets/sketch runtime; commit f3aa5b9). Read `AGENTS.md`, `AGENT_MEMORY.md`, `docs/decisions/LOG.md` (D29, D31, D32), then the files named below before changing anything. An external review was verified by the orchestrator; the items below are the accepted, amended fixes.

## Non-negotiables
- Sandbox guarantees unchanged: every visual iframe is exactly `sandbox="allow-scripts"` (no `allow-same-origin`, `allow-popups`, `allow-top-navigation`, `allow-forms`), `referrerPolicy="no-referrer"`, CSP meta first in `srcdoc`, `connect-src 'none'`. Don't widen the CSP.
- Notes stay plain Markdown (D6). No new dependencies. Scoped tests only, no full suite. No commits/push/branch.
- Never edit `AGENT_MEMORY.md` (log entry in your report), `.env*`, `.claude/`; `data/` is read-only. Only stop processes you started (save `$!`); never pkill/killall. `pnpm install --frozen-lockfile --prefer-offline` first. Biome via `rtk proxy pnpm exec biome check <files>`.
- If a step doesn't fit the real code, stop that item, report file:line, continue.

## 1. Component tests for the new iframe path (security-critical)
**Problem:** `web/src/components/Reader/{VisualBlock,SketchBlock}.tsx` are never mounted in tests; only pure helpers in `web/src/visual-runtime/sandbox.test.ts` are. The legacy `ArtifactBlock` has DOM-level tests (`Reader.test.tsx` ≈137–200).
**Fix:** add `SketchBlock.test.tsx` and `VisualBlock.test.tsx` (pattern of the artifact tests; stub `fetch`, `location.origin`). Assert at the rendered DOM: `sandbox` attribute is exactly `allow-scripts`; `referrerpolicy="no-referrer"`; `srcdoc` starts with `sketchCsp(origin)`; only manifest-declared libs + `studium-runtime` appear as `<script src>`; **no iframe exists until the document is built** (item 4c); manifest fetch failure → connection error with retry → retry refetches and mounts the frame; malformed sketch header → content error, no retry (item 4b); a foreign `postMessage` (wrong `source`) is ignored; a widget JSON loads `WidgetBlock` without any iframe.

## 2. Skill drift (amended: more files than reported)
**Problem:** D32 makes `make-visual` the single source and `::visual` + `visuals/` the convention, but these still teach `::artifact` for new interactive work:
- `skills/note-authoring/SKILL.md:97` (also points to `media-authoring` instead of `make-visual`),
- `skills/draft-chapter/references/subject-math.md:24`, `subject-science.md:25`, `subject-technology.md:23`.
**Fix:** reword each to: load `make-visual`; create a widget JSON or runtime sketch (+ poster) in `visuals/`; append a standalone `::visual{…}` at the chapter end; existing `::artifact` attachments are preserved, not created anew. Keep `media-authoring:101` (legacy compatibility, correct). Then run `node scripts/skill-history.mjs` and `rtk proxy pnpm exec biome format --write skills/.defaults-history.json` so user trees receive the update (sync skips user-edited skills).

## 3. Full screen: no restart, same affordance everywhere
**Problem:** `ArtifactBlock.tsx:112` returns `full ? createPortal(body, document.body) : body`. Toggling switches between two different React tree positions, so React **unmounts and recreates** the section and its iframe (not a DOM move) — the frame reloads and a running visual restarts. `VisualBlock`/`SketchBlock`/`WidgetBlock` have no full screen at all.
**Fix:** one shared `VisualFrame` wrapper (or hook) used by ArtifactBlock and VisualBlock: the element tree never changes on toggle; full screen is CSS only (`fixed inset-0 z-50` on the same container, body scroll locked, Escape and an "Exit full screen" button, focus moved to the exit button and restored on exit). Before relying on `position: fixed`, check the Reader/Visuals ancestors for `transform`, `filter`, `contain` or `will-change` that would trap a fixed child (report what you found; if one exists, remove it from that ancestor only if harmless, otherwise use the native Fullscreen API on the same container as a fallback — still no reparenting). Test: toggling full screen keeps the same iframe element (`toBe` identity) and the same `srcdoc`, for a sketch and for a legacy artifact; widgets get the same button.

## 4. SketchBlock / VisualBlock rough edges (amended: VisualBlock has the same error collapse)
- **(a)** `SketchBlock.tsx:47` `const document = useMemo(…)` shadows the global — rename to `srcDoc`.
- **(b)** Every failure shows "This visual couldn't be opened. Connect and try again." with Try again: manifest fetch failure (`SketchBlock.tsx:24–44`), invalid manifest, `sketchDocument` throw on a malformed header/unknown lib (`:47–54` → `null` → `:74`), and a runtime `error` event from the sketch itself (`:69`); in `VisualBlock.tsx:31–41`, `parseWidget` throwing on an invalid widget spec and an invalid path (`:22–24`) land in the same message. Split into: **connection** (fetch/HTTP failure or `navigator.onLine === false`) → "This visual needs a connection." + Try again; **content** (invalid manifest entry, malformed sketch header, invalid widget spec, invalid path, oversize) → "This visual has a problem and can't be shown." no retry, with the error detail in a collapsed `<details>` (text only, ≤ 300 chars); **runtime** (`error` event from the frame) → "This visual stopped with an error." + Restart (remounts the frame). Unit-test each path.
- **(c)** While the manifest loads, `SketchBlock` renders `<iframe srcDoc="">` and `onLoad` posts a control message into the empty frame (`:93–101`). Render the skeleton until `srcDoc` exists; mount the iframe only with the built document.

## 5. Offline for the new runtime (amended: the reviewer's mechanism won't work as stated)
**Facts:** `web/vite.config.ts:42` excludes `visual-runtime/**` from precache and no runtime-caching rule covers it; `server/src/http/visual-runtime.ts:14` serves hashed libs `public, max-age=31536000, immutable` and `manifest.json` `no-cache`. Library `<script>` loads happen **inside the sandboxed srcdoc frame (opaque origin)**, which a service worker generally does not control, so a Workbox rule would not serve those script loads; they rely on the browser HTTP cache (immutable, already effective after first use). The real offline blocker is the **parent's `manifest.json` fetch** (SW-controlled, `no-cache`) — offline it fails and the whole sketch errors even when the libs are in the HTTP cache. Widgets need no runtime and already work offline once their JSON (`/api/sets/:set/file`, network-first cached) was read.
**Fix:** add a Workbox runtime rule for `/visual-runtime/manifest.json` (NetworkFirst, 3 s timeout, 1 entry) and for `/visual-runtime/*.js` (CacheFirst, ≤ 12 entries, 90 days) — the latter helps only where the browser lets the SW handle the frame's loads; keep precache exclusion (≈2 MB of p5/three/d3 must not download at install). Verify in a real browser (Chromium, offline emulation): open a sketch online once, go offline, reload, reopen it — record whether it plays and which cache served each request; document the result honestly in `docs/UI.md` (replace "offline uncached visuals explain that a connection is needed" with the measured behaviour: widgets offline yes; sketches offline after first use when the browser HTTP cache still has the libs; otherwise the connection message from 4b).

## 6. Misplaced declarations vanish silently (amended: both directive names, both layers)
**Problem:** `shared/src/chapter-visuals.ts:28` collects only lines matching `^ {0,3}::(artifact|visual){…}`. A declaration inside a blockquote (`> ::visual{…}`), a list item indented ≥ 4, or a callout container stays in the body; in prose `::visual` has no handler in `remarkStudium.ts` and renders nothing, and `::artifact` is tagged `data-artifact` and then dropped by `MarkdownView.tsx:47` (`return null`). Neither appears in the Visuals tab. Agent writes of notes are not checked for this (`validateAgentMedia` in `server/src/tree/media.ts:20` only validates media files; `server/src/agent/media-warnings.ts` is advisory).
**Fix (both):**
- **Write time (agents):** in the strict agent note-write path (same place the frontmatter repair/note lint run for non-user holders — see `server/src/tree/edit.ts` and `server/src/agent/note-lint.ts`), reject a note whose `::visual`/`::artifact` declaration is not collectable by `chapterVisuals()` (i.e. present in the parsed tree but absent from the collected list), with: "Visual declarations must be standalone top-level lines at the end of the chapter, outside lists, quotes and callouts: ::visual{src=\"../visuals/x.json\" title=\"…\"}". Learner saves are never rejected.
- **Reader (existing/learner content):** render a misplaced declaration in prose as a small muted line "Visual not shown: move this declaration to its own line at the chapter end" (for both names) instead of nothing.
- Tests: shared collector cases (2-space list continuation still collected; `>` quote, 4-space, inside `:::example` not collected), write rejection for agent holders only, reader marker.

## Verification
```
pnpm --filter @studium/web exec vitest run src/components/Reader src/visual-runtime
pnpm --filter @studium/shared exec vitest run src/media.test.ts src/visuals
pnpm --filter @studium/server exec vitest run src/tree/ src/agent/note-lint.test.ts src/agent/tools.test.ts
pnpm --filter @studium/web exec tsc --noEmit
pnpm --filter @studium/shared exec tsc --noEmit
pnpm --filter @studium/server exec tsc --noEmit
pnpm --filter @studium/web build
rtk proxy pnpm exec biome check <changed files>
```
Browser (temp copy of `examples/sample-set`, admin from env, `STUDIUM_FAUX=1`, own port; real clicks; 390×844 and 1440×900, light and dark): full screen on a playing sketch keeps playing (no restart) and exits by button and Escape; the three error states show the right copy; offline check per item 5.

## Acceptance
- New component tests assert the sandbox/CSP/script-injection/no-early-iframe guarantees at DOM level and pass.
- No skill teaches `::artifact` for new work; defaults history updated.
- Full screen never reloads a frame and exists for widgets, sketches and legacy artifacts.
- Connection, content and runtime failures are distinguishable; retry only where it can help.
- Offline behaviour measured and documented; manifest no longer blocks cached sketches.
- Misplaced declarations are rejected for agents and visibly flagged for existing content.

Final report: changed files per item, tests with pass/fail counts, browser and offline results, deviations, 5-line log entry.
