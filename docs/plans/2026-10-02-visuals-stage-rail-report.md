# Visuals stage + rail implementation report — 2026-10-02

Implemented locally on `codex/visuals-fixes` from `docs/prompts/visuals-stage-rail.md`, directly after the fixes pass (same worktree, uncommitted; synced to origin/main `8533745` first via stash → `git pull --rebase origin main` → stash pop — zero overlap with my uncommitted files, clean pop). No commits, pushes, branches, sub-agents, orchestration skills, new dependencies or full-suite runs. `AGENT_MEMORY.md`, `.env*`, `.claude/`, live `data/` untouched. Temp server (port 3197, temp data dir, `STUDIUM_FAUX=1`) stopped via saved PID; evidence in `/tmp/studium-vfix-8VZ4`.

## What was built (per the accepted decisions A–D)

- **A. Stage + rail** (`ChapterVisuals.tsx` rewritten): one visual mounted at a time; exactly one visual → no rail. Rail = horizontal scrollable thumbnail strip (desktop above the stage, `order-last` below it on phones), active card highlighted (`aria-current`, accent) and auto-scrolled into view. Thumbnails per the amended priority: declaration `poster="…"` img → widget default-state SVG (fetches only the small JSON, cached per src) → kind-icon card. Context bar: "← Back to reading" + "Visuals · N in this chapter".
- **Thumbnails/poster-first** (`VisualBlock.tsx`): a staged sketch with a declared poster shows the poster at final canvas size immediately — the poster IS the placeholder (no skeleton on top); the live frame fades in on the runtime's `ready` message (new `onReady` on SketchBlock), then the poster goes `opacity-0`/`aria-hidden` (motion-safe transition, no remount, no layout shift). The sample tree's `stretch.html` declaration now carries `poster=` in the temp copy; `skills/make-visual` now instructs agents to always write `poster="…"` on sketch declarations (defaults history updated).
- **Uniform strip** (`VisualStrip` in `VisualFrame.tsx`): prev/next visual (hidden without neighbors) + kind-appropriate core: widgets Play/Pause + scene stepper `‹ scene 2/2 scene ›` (driving the widget directly via a new `apiRef`/`onStoryState` story surface on `WidgetBlock` — the in-widget duplicate Previous/Play/Next/scene-dots were removed, narration stays); sketches Play/Pause via the **extended control message** `{type:"studium-visual-control", playing}` — parsing extracted into `web/src/visual-runtime/control-message.ts` (shared by `runtime.js`, now bundled with its import) where a known field with the wrong type voids the whole message; in-frame chrome untouched. Legacy artifacts: Restart (back to the Run gate) + Expand only. Restart on widget/sketch = key-remount (fresh element, proven in-browser).
- **Keyboard**: plain ←/→ keep stepping scenes inside the focused widget/sketch (untouched); **Shift+←/→** stage prev/next visual from anywhere in the view (ignored from text inputs; focus inside a frame never reaches the parent handler by construction).
- **B. Whisper**: one muted line at the END of the reading panel — "Explore this chapter's N visuals →" (`VisualsWhisper.tsx`, eager tiny module so Reader's visuals chunks stay lazy); absent at N=0; singular/plural handled.
- **C. URL**: `?view=visuals&v=<stem>` (file stem of the declaration's src, numeric 1-based fallback for src-less entries); unknown id → first visual. Staging pushes history, so Back walks the stage (verified in-browser).
- **Motion**: poster cross-fade ≤200 ms via `motion-safe:` classes (off under `prefers-reduced-motion`); no tab cross-fade was added — the panels must keep unmounting to stop media, so a two-panel crossfade would regress that guarantee (deviation, see below).

## Tests and checks

| Exact command | Result |
| --- | --- |
| `pnpm --filter @studium/web exec vitest run src/components/Reader src/visual-runtime` | **67 passed, 1 skipped** (8 new stage-rail tests; all fixes-pass tests intact and extended, not replaced) |
| `pnpm --filter @studium/web exec tsc --noEmit` | pass, 0 errors |
| `pnpm --filter @studium/web build` | pass (runtime prebuild + SW regenerated) |
| `rtk proxy pnpm exec biome check <changed web files>` | pass (4 real findings fixed along the way: useless ctor, suppression placement, array-index key suppression with reason, and the fieldset swap below) |

New coverage: rail hidden for one visual; staging via rail/Shift+arrows/URL `v=`; Back restores the previous stage; exactly one visual mounted; poster-before-live lifecycle (deferred fetch, ready signal); strip per kind (widget stepper + play, sketch play only, artifact restart+expand after Run); plain ←/→ still step widget scenes; whisper N>0/N=0 + opens the tab; `parseVisualControl` honours `playing` and rejects every malformed shape. Two M9-era tests (`WidgetBlock.test`, `playback.test`) that asserted the removed in-widget story buttons were updated to the amended design (strip owns play/scene; keyboard unchanged).

## Browser checks (real Chrome, temp copy of `examples/sample-set` seeded with 1/3/6-visual chapters plus broken/throwing sketches; real clicks)

- **6 visuals @1440 + @390, dark + light**: rail with poster/widget thumbs and icon fallbacks; one staged section at all times; rail internally scrollable with the active card kept in view; **no horizontal page scroll after fixing a real bug the checks caught** — the biome-suggested `<fieldset>` for the rail has an intrinsic min-content width that forced the page to 468 px on phones; `min-w-0` restores 390.
- **Staging & URL**: rail clicks, Shift+←/→, deep links (`v=stretch`, unknown→first) all stage correctly; each stage pushes history — Back returns to the previous stage with the right URL; plain ←/→ leave the stage alone.
- **Poster-first**: poster shown (not aria-hidden) until the frame is live; hidden after ready. On localhost with warm caches the transition is too fast to observe by polling — the deterministic proof is the deferred-fetch component test; under `Slow 3G` everything (html, manifest, libs) came from immutable HTTP cache, so the poster never had to wait — which is the desired steady state.
- **Strip**: widget Play/Pause + `‹ scene 2/2 scene ›` + Restart + Full screen; sketch Pause **propagates into the frame** (the in-frame button flipped to "Play" — the extended `playing` message honoured end-to-end); artifact Restart returns to the Run gate; expand keeps the exact iframe element (dataset-probe identity) on enter/exit at both viewports and both themes.
- **Errors staged from the rail**: broken sketch → content copy; throwing sketch → runtime copy + Restart cycling.
- **Whisper**: present with correct grammar at the end of Reading ("1 visual"/"3 visuals"), absent in an empty chapter, opens the Visuals tab.
- **Reduced motion**: not browser-verifiable with the available tooling (no `prefers-reduced-motion` emulation) — behaviour is class-gated (`motion-safe:`, `motion-reduce:animate-none`) and covered by the reduced-motion component tests from the fixes pass.

## Deviations / notes for review

- **No tab crossfade** (prompt's motion bullet): the Reading panel unmounts the Visuals panel precisely to stop media and restore scroll; a true crossfade needs both mounted, regressing that. Poster fade, rail and strip transitions are in. Flagged for the orchestrator to overrule if a crossfade is wanted despite the trade-off.
- The rail's `role="group"` became a real `<fieldset aria-label>` at biome's suggestion (same implicit role, tests unchanged) — which then needed `min-w-0` for the fieldset min-content quirk (caught in-browser, not by tests).
- Rail thumbnails for widgets fetch the widget JSONs of the whole chapter (small, per the prompt's amendment); failures degrade to icon cards silently.
- The 6-visual chapter staged the throwing sketch with `v=boom` — src-less (unavailable) entries have no stem and stage by index without a `v` param.
- WebKit/iPhone not available on this host.

## Five-line memory log

```text
2026-10-02 · visuals-stage-rail (ZCode/GLM-5.3): prompt docs/prompts/visuals-stage-rail.md on codex/visuals-fixes, after visuals-review-fixes, on rebased main 8533745.
ChapterVisuals = stage+rail+context bar; ?view=visuals&v=<stem> pushes per stage (Back walks); rail = poster/widget-SVG/icon thumbs, fieldset+min-w-0 (min-content quirk forced 468px on phones).
Uniform VisualStrip: prev/next visual, widget play+scene via WidgetBlock apiRef/onStoryState, sketch play via control-message.ts playing extension (malformed ⇒ ignored), artifact restart+expand.
Poster-first stage (poster IS the placeholder; fades on runtime ready via SketchBlock onReady); Shift+←/→ stage, plain arrows stay with scenes; whisper at reading end (VisualsWhisper.tsx); make-visual now requires poster= on sketch declarations.
67 web tests pass (8 new); browser: 1/3/6 visuals @390/1440 light+dark, staging/Back/expand-identity/errors verified; tab crossfade skipped (would regress panel unmount) — flagged for orchestrator.
```
