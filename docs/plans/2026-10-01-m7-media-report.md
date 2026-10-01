# M7 implementation report — 2026-10-01

Implemented phases 1–6 and F1–F11 on `codex/m7`, with the exceptions and existing-code differences listed below. Changes remain uncommitted. No branches, PRs, pushes, subagents, orchestration workflow, real provider calls, or paid smoke tests were used. `AGENT_MEMORY.md`, `.env*`, `data/`, `.claude/`, and the real study tree were not edited.

## Changed files by phase

Files used across phases appear once, with their combined changes described.

### Phase 1 — Local figures, image routes and book images

- `server/src/tree/paths.ts`: allow agent assets/artifacts using existing path rules.
- `server/src/tree/paths.test.ts`: cover new folders, traversal, reserved library and invalid slugs.
- `server/src/tree/media.ts`: shared image MIME/headers, complete SVG/HTML validation and 50 MB asset quota.
- `server/src/tree/edit.ts`: validate complete media documents under write locks; serialize asset quota mutations.
- `server/src/agent/roles.ts`: media scopes, skills and save_asset allowlists; read-only tutor library scope and drafter SearXNG fallback.
- `server/src/agent/tools.ts`: advisory media-write warnings and tutor library reads without library writes.
- `server/src/agent/tools.test.ts`: safe/unsafe media writes, size/quota limits and advisory warnings.
- `server/src/routes/sets.ts`: confined asset serving, image headers/limits, raw artifact HTML and 1 MB file-read cap.
- `server/src/routes/sets.test.ts`: asset bytes/MIME, denied paths/extensions and raw HTML/file cap.
- `server/src/jobs/book-media.ts`: copy confined inline/reference images, preprocess YouTube/artifact directives and render chart SVGs.
- `server/src/jobs/book-assemble.ts`: optional per-chapter media preprocessing hook.
- `server/src/jobs/book-job.ts`: run media preprocessing before Pandoc; injectable compiler runner for focused tests.
- `server/src/jobs/book-job.test.ts`: copied bytes/rewrites, actual SVG+PNG compilation, static video/chart/artifact forms and stubbed compiler handoff.
- `server/templates/book/callouts.lua`: keep only confined `media/` images; degrade other images to caption/URL text.
- `shared/src/media.ts`: note-relative media confinement, YouTube attributes/IDs/time, leaf attributes and inline chart validation.
- `shared/src/media.test.ts`: path confinement, YouTube validation and inline chart restrictions.
- `shared/src/index.ts`: export media helpers.
- `shared/package.json`: direct `./media` export keeps media-only browser imports independent of YAML/schema modules.
- `shared/tsconfig.json`: include DOM types for the shared URL API.
- `web/src/components/Reader/NoteImage.tsx`: confined local images, HTTPS note images, local-only chat mode, lazy decoding and captions; readable SVG backdrop.
- `web/src/components/Reader/MarkdownView.tsx`: optional notePath, media components, sanitization-preserving rendering and lazy code/citation/embed components.
- `web/src/components/Reader/ReaderPassages.tsx`: supply the actual chapter path to MarkdownView.
- `web/src/components/Reader/Reader.test.tsx`: image paths/captions, video click-to-load, timestamp citations, chart fallback and artifact validation/sandbox/retry.
- `web/vite.config.ts`: asset/thumb entries in the bounded offline API cache; exclude heavy Vega code from unconditional PWA precaching.

### Phase 2 — Discovered and saved web images

- `server/src/ingest/images.ts`: collect up to 50 HTTPS Markdown images before cleaning, with alt/heading and known-size filtering; support reference images.
- `server/src/ingest/types.ts`: image metadata and thumbnail fields on extracted sources; preserve image metadata through conversion.
- `server/src/ingest/web.ts`: collect images for plain extraction and Firecrawl Markdown.
- `server/src/ingest/web.test.ts`: actual Firecrawl image fixture and metadata assertion.
- `server/src/ingest/library.ts`: persist tracked `images.json` and `thumb.jpg` beside source files.
- `server/src/ingest/library.test.ts`: source image filtering/reference discovery and metadata persistence.
- `server/src/ingest/safe-fetch.ts`: optional HTTPS-only policy checked on every redirect hop.
- `server/src/ingest/safe-fetch.test.ts`: refuse an HTTPS-to-HTTP redirect before fetching the HTTP destination.
- `server/src/agent/builtins/save-asset.ts`: public HTTPS raster download, MIME/magic/dimension checks, quota, collision suffixes, locked writes and credit sidecars.
- `server/src/agent/builtins/save-asset.test.ts`: SSRF, protocol/size/MIME/SVG/dimension rejection, headers, collision, quota and commit notifications.
- `server/src/agent/run-role.ts`: register save_asset with normal role write tracking/authorization.
- `server/src/jobs/draft-job.ts`: permit chapter media alongside the reserved note and include it in normal draft/revision commits.
- `server/src/jobs/draft-job.test.ts`: confirm the draft figure is included in the drafter commit while other notes remain forbidden.

### Phase 3 — YouTube moments and chat limits

- `server/src/ingest/youtube.ts`: paragraph timestamp markers, shared ID validation and nonfatal confined thumbnail download.
- `server/src/ingest/youtube.test.ts`: paragraph timestamps, thumbnail success/failure and stricter ID host validation.
- `server/src/routes/library.ts`: confined local thumbnail route with private cache/security headers.
- `server/src/routes/library.test.ts`: thumbnail bytes, headers, missing file and symlink rejection.
- `server/src/search/plaintext.test.ts`: verify generic comment stripping also removes timestamp markers.
- `web/src/components/Reader/remarkStudium.ts`: validated leaf media directives, plain chat links and page/time citation tags.
- `web/src/components/Reader/YouTubeEmbed.tsx`: internal-library thumbnail lookup, placeholder, explicit play action, exact nocookie iframe attributes and timed watch link.
- `web/src/components/Reader/Citation.tsx`: timestamp tooltip and source-validated timed YouTube link; retain page citations.
- `web/src/components/ChatDock/MessageMarkdown.tsx`: plain media directive links and same-set images only.
- `web/src/components/ChatDock/MessageMarkdown.test.tsx`: plain links/local images without embeds or remote chat images.
- `web/src/components/ChatDock/useChatDock.ts`: derive media notePath from the active set/anchor.
- `web/src/components/ChatDock/ChatPanel.tsx`: pass notePath through message bubbles.

### Phase 4 — Vega-Lite charts

- `server/src/jobs/vega.ts`: light SVG rendering with compiled AST expressions and rejecting loaders.
- `server/src/jobs/vega.test.ts`: real inline SVG rendering and external resource rejection.
- `web/src/lib/vega-loader.ts`: lazy Vega imports, AST interpreter, rejecting loaders and theme/container configuration.
- `web/src/components/Reader/VegaLiteBlock.tsx`: SVG lifecycle, resize/theme redraws, cleanup and readable error fallback.
- `web/src/components/Reader/CodeBlock.tsx`: lazily route vega-lite fences to the chart component.
- `web/src/components/Reader/utils.ts`: preserve hyphenated code language names.
- `server/package.json`: exact `vega@6.4.0`, `vega-lite@6.4.3`, `vega-interpreter@2.3.2`.
- `web/package.json`: the same three exact dependencies.
- `pnpm-lock.yaml`: only the approved Vega dependency additions and their transitive packages.

### Phase 5 — Interactive artifacts

- `web/src/components/Reader/ArtifactBlock.tsx`: poster/Run, deferred raw-file fetch, exact first-document CSP, scripts-only sandbox, retry/offline notice and CSS fullscreen toggle.

Artifact parsing, book poster handling and tests are in the shared files listed under phases 1 and 3.

### Phase 6 — Skills, warnings and documentation

- `server/src/agent/media-warnings.ts`: advisory missing image/artifact/poster and unregistered-video checks, including image references.
- `server/src/agent/prompt.ts`: tutor/drafter media write instructions consistent with the new scopes.
- `server/src/agent/roles.test.ts`: tutor can read image lists but cannot write library files; role tools remain exactly allowlisted.
- `server/src/tree/init.test.ts`: new default media skill in initialized trees.
- `skills/media-authoring/SKILL.md`: concise visual choices, figure rules, saved-image credits, timestamp video citations, local charts/artifacts and card restriction.
- `skills/note-authoring/SKILL.md`: point to media-authoring.
- `skills/draft-chapter/SKILL.md`: point to media-authoring.
- `skills/explain/SKILL.md`: point to media-authoring.
- `skills/make-deck/SKILL.md`: F11 restriction in the actual cardsmith skill.
- `skills/.defaults-history.json`: register new and changed skill hashes using the existing script.
- `docs/decisions/LOG.md`: D29 with F1–F11, media forms and deferrals.
- `docs/STUDY_TREE.md`: asset/artifact folders, credits, source image lists, thumbnails and timestamp markers.
- `docs/AGENT_ROLES.md`: tool/write/read scopes and optional image search fallback.
- `docs/UI.md`: media rendering, tap-to-load and chat behavior.
- `docs/plans/2026-10-01-m7-media-report.md`: this handoff and verification record.

## Tests and verification

First ran `pnpm install --frozen-lockfile --prefer-offline` successfully. Each phase was tested before the next phase started. Tests used temporary trees and stubbed providers/network services.

### Phase checkpoints

| Phase | Exact command | Result |
| --- | --- | --- |
| 1 | `pnpm --filter @studium/server exec vitest run src/tree/ src/agent/tools.test.ts src/agent/roles.test.ts src/routes/sets.test.ts src/jobs/book-job.test.ts` | Initially 120 pass / 1 fail: invalid PNG fixture CRC; replaced fixture. |
| 1 | `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts -t 'copies confined SVG'` | 1 pass / 11 skipped; actual SVG+PNG PDF compile passed. |
| 1 | `pnpm --filter @studium/web exec vitest run src/components/Reader` | 11 pass. |
| 2 | `pnpm --filter @studium/server exec vitest run src/agent/builtins/save-asset.test.ts src/agent/roles.test.ts src/ingest/library.test.ts src/ingest/web.test.ts` | 33 pass. |
| 2 | `pnpm --filter @studium/server exec vitest run src/jobs/draft-job.test.ts src/agent/roles.test.ts src/agent/builtins/save-asset.test.ts` | 25 pass. |
| 3 | `pnpm --filter @studium/server exec vitest run src/ingest/youtube.test.ts src/ingest/library.test.ts src/routes/library.test.ts src/jobs/book-job.test.ts src/search/plaintext.test.ts` | 60 pass. |
| 3 | `pnpm --filter @studium/web exec vitest run src/components/Reader` | 14 pass. |
| 4 | `pnpm --filter @studium/server exec vitest run src/jobs/vega.test.ts src/jobs/book-job.test.ts` | 16 pass. |
| 4 | `pnpm --filter @studium/web exec vitest run src/components/Reader` | 15 pass. |
| 5 | `pnpm --filter @studium/server exec vitest run src/jobs/book-job.test.ts` | 15 pass. |
| 5 | `pnpm --filter @studium/web exec vitest run src/components/Reader` | 18 pass. |
| 6 | `pnpm --filter @studium/server exec vitest run src/tree/ src/agent/tools.test.ts src/agent/roles.test.ts src/agent/builtins/skills.test.ts src/jobs/draft-job.test.ts` | 112 pass after updating the expected initialized skill list. |
| 6 | `pnpm --filter @studium/shared exec vitest run src/media.test.ts` | 3 pass. |
| 6 | `pnpm --filter @studium/web exec vitest run src/components/Reader src/components/ChatDock/MessageMarkdown.test.tsx` | 20 pass. |

### Final scoped verification

| Exact command | Final result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/tree/` | 75 pass / 0 fail, 8 files. |
| `pnpm --filter @studium/server exec vitest run src/routes src/agent/builtins/save-asset.test.ts src/ingest/youtube.test.ts src/ingest/library.test.ts src/jobs/book-job.test.ts` | 128 pass / 0 fail, 16 files. |
| `pnpm --filter @studium/web exec vitest run src/components/Reader` | 18 pass / 0 fail, 3 files. |
| `pnpm --filter @studium/server exec vitest run src/agent/roles.test.ts src/agent/tools.test.ts src/jobs/draft-job.test.ts src/jobs/vega.test.ts src/ingest/web.test.ts src/ingest/safe-fetch.test.ts` | 57 pass / 0 fail, 6 files. |
| `pnpm --filter @studium/web exec vitest run src/components/ChatDock/MessageMarkdown.test.tsx` | 2 pass / 0 fail. |
| `pnpm --filter @studium/shared exec vitest run src/media.test.ts` | 3 pass / 0 fail. |
| `pnpm --filter @studium/server exec vitest run src/ingest/web.test.ts src/agent/roles.test.ts` | 20 pass / 0 fail after the final prompt/Firecrawl fixture update. |
| `pnpm --filter @studium/server exec vitest run src/agent/roles.test.ts` | 16 pass / 0 fail after adding the drafter image-search fallback. |
| `pnpm --filter @studium/server exec tsc --noEmit` | Pass. |
| `pnpm --filter @studium/web exec tsc --noEmit` | Pass. |
| `pnpm --filter @studium/shared exec tsc --noEmit` | Pass. |
| `pnpm --filter @studium/web build` | Pass; existing large lazy-chunk warning remains. |
| `rtk proxy pnpm exec biome check <changed .ts/.tsx/.json files>` | Pass, 62 files, no fixes; the path list was taken from `git diff --name-only` and untracked files. |
| `git diff --check` | Pass. |
| `node scripts/skill-history.mjs` | Pass; hashes registered. |

The six final scoped test groups cover 283 tests, all passing. Do not sum repeated checkpoint runs as additional coverage. A concurrent final route run first had 127 pass / 1 timeout in `src/routes/today.test.ts:21` at 5 seconds. The same requested command passed on its own, with no unrelated source or timeout changes. Intermediate mock/fixture/type issues and the lazy-artifact test timing were corrected before the passing runs above. No full-suite test command was run.

## Browser, book and bundle checks

Test server: `127.0.0.1:3190`, faux mode, isolated copy of `examples/sample-set` at `/tmp/studium-m7-yc906itg`, temporary admin configured via process environment. Only the saved PID of this test server was stopped after verification.

`node /tmp/m7-browser.mjs` passed at **390×844** and **1440×900**, in **light** and **dark** mode. All four images loaded. There were zero YouTube/ytimg requests before Play and zero iframes before Run/Play. The resulting player URL retained start=843/end=900 and nocookie. Watch link remained visible. Artifact sandbox was exactly `allow-scripts`, srcDoc began with the specified CSP meta, the attempted fetch was rejected with a CSP console message, and fullscreen toggled successfully. Charts changed accent from `oklch(45% .08 250)` to `oklch(72% .11 250)`. No page errors or horizontal overflow occurred. Transparent SVGs were visually inspected with their readable light backdrop in dark mode.

The harness suppressed service-worker registration to avoid deployment reloads during the four deterministic UI checks. YouTube's external embed request after Play was observed and aborted by the harness; third-party playback availability was not tested. This does not affect the pre-tap network assertion. Earlier harness errors were caused by a setup script executing inside sandboxed frames; the final harness only writes localStorage in the top frame.

- Browser screenshots: `/tmp/studium-m7-yc906itg/{390,1440}-{light,dark}.png`.
- Browser results: `/tmp/m7-browser-results.log`.
- Real book command: `node --import ./server/node_modules/tsx/dist/loader.mjs /tmp/m7-compile.mts` — passed with Pandoc and Typst 0.15.1.
- PDF: `/tmp/studium-m7-yc906itg/state/users/m7tester/linear-algebra/.cache/book/linear-algebra.pdf` — 9 pages, approximately 101 KB. Rendered pages 6–8 with `pdftoppm` and visually inspected the SVG, PNG, local thumbnail, time/citation, chart and poster/captions.
- WebP command: `typst compile --root /tmp/m7-webp-check /tmp/m7-webp-check/test.typ /tmp/m7-webp-check/test.pdf` — passed with a real WebP image. F4 needs no caption-only fallback on this host.
- Vega heavy lazy chunk: **249.97 kB gzip**, as reported by Vite; chart wrapper **1.24 kB gzip**.
- Initial JS including every HTML modulepreload: committed baseline **275,510 bytes gzip**, M7 **275,022 bytes gzip** (488 bytes smaller).
- Initial JS plus CSS: baseline **291,261 bytes gzip**, M7 **290,858 bytes gzip** (403 bytes smaller).

Bundle comparison used a temporary `git archive HEAD` copy of web/shared, the same installed dependencies, and Node `zlib.gzipSync` on each unique script/modulepreload/stylesheet referenced by built index.html. Heavy Vega imports remain dynamic and its chunk is excluded from unconditional PWA precaching. `/tmp/m7-final-build.log` contains the final Vite report.

## Integration edits and deviations

- The Reader actually renders chapters through `ReaderPassages.tsx:303`; notePath was wired there rather than directly through Reader.tsx.
- The draft job originally restricted writes and commits to exactly one note. It now additionally permits/commits media within that same set; the reserved-note restriction remains tested.
- Tutor study tools originally could not read `library/<id>/images.json`; they now have read-only library access. Drafter's MCP list now includes optional SearXNG for the skill's required image-search fallback. Both remain governed by normal role authorization.
- Tool registration, prompt scopes, extracted-source fields, direct shared media export/URL types, asset/thumb cache entries and skill-history registration are the minimal integrations needed for the plan's behavior.
- Existing splitter/comment handling already preserves page and timestamp markers in source files and strips generic HTML comments from visible/search plaintext; no unnecessary splitter rewrite was made.
- Context7 was used for remark-directive, Pandoc Lua, Typst image support and Vega APIs through its public MCP endpoint (`tools/list`, `resolve-library-id`, `query-docs`), because no named Context7 tool was exposed in this session.
- Explicit Phase 1 behavior was followed for unsaved HTTPS note images: the reader can load them; the book never fetches them. D29 documents this exception to the plan's broader opening sentence.

## Not done / open gaps

- **Old YouTube transcripts:** no refresh/re-ingest action or route exists (`web/src/pages/LibrarySourcePage.tsx:92` exposes metadata/original/parsed files; library routes expose existing ingest paths). Per Phase 3, no new refresh UI was built; old sources still lack new timestamp markers/thumbnails until re-ingested through future work.
- **Mermaid book table mismatch:** `server/src/jobs/book-assemble.ts:38` already turns Mermaid into `*(diagram in the app)*`; it does not preserve the fenced code described by the plan's “unchanged” table cell. Existing behavior was retained and documented. Mermaid SVG export stays deferred.
- **Explicit deferrals retained:** Anki media, chat embeds and server-rendered artifact posters.
- No remaining implementation/test failure is known. External YouTube playback and live image-search/provider services were intentionally not exercised.

## Five-line log for AGENT_MEMORY.md

```text
2026-10-01 M7: phases 1–6 implemented on codex/m7; changes uncommitted for orchestrator review.
Added confined figures/assets, safe credited raster saves, source image lists and timestamped local video thumbnails.
Added theme-aware AST Vega charts, click-run CSP artifacts, plain chat links and static book media forms.
Validated 283 scoped tests, package types, Biome/build, four browser combinations, real PDF and Typst WebP.
Gotchas: no YouTube refresh path; Mermaid PDF placeholder retained; direct shared/media export avoids barrel coupling.
```
