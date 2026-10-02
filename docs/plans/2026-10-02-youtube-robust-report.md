# YouTube embeds robust end-to-end — implementation report

2026-10-02 · `/home/krishna/learny-worktrees/yt` · branch `codex/yt` · uncommitted.

## Design decisions and root causes

- The old reader recognized only `::youtube` directives. Bare, labelled and reference links stayed plain links. Add players through the Markdown AST, preserve labels/prose, and put blocks outside paragraph/heading phrasing or inside table cells. Repeated moments within a paragraph and matching adjacent directives share one player.
- Ingest detection missed apex `youtube.com` and `youtube-nocookie.com`; it also used a broader host rule than rendering. Use the same validated video parser for detection, source identification, dedupe and rendering. Caption extraction receives a validated ID rather than relying on the transcript package's URL parsing. Existing transcript paragraph markers remain intact.
- Drafting did not explicitly require a link to video sources. Give initial drafts, rewrites and revisions canonical URLs keyed by registered source ID. Skills require a descriptive nearby watch link, transcript-supported times and defined `#tN` citations, with whole-video links when old transcripts lack markers. Preserve URLs during source summarization and links during note edits.
- Note writes warn about missing watch links. The existing checker/revision cycle also makes omissions blockers, and `set_note_status` cannot bypass that check. Code fences (including nested shorter fences), inline code, frontmatter URLs, comments, raw HTML and hostile host substrings cannot satisfy the check.
- Accept watch/share/shorts/live/embed/v, mobile/music, nocookie embeds, scheme-less/protocol-relative forms, trailing slashes, default ports, encoded IDs and optional tracking/playlist parameters. Parse `t`, `start`, `time_continue` and `#t=` as seconds or h/m/s units. Bad optional URL times fall back to zero; explicit directive times must be safe nonnegative integers, with end after start. Explicit bounds override URL bounds.
- Allow only exact known hosts and valid 11-character IDs. Reject lookalikes, arbitrary subdomains, credentials, unusual ports, non-HTTP schemes, extra path components, duplicate video IDs, malformed/double encoding and control characters. Component props are revalidated; all iframe/watch URLs are built from validated values. Raw HTML remains blocked and the sanitizer has no new escape hatch.
- Retain D29: click-to-load, local thumbnail/placeholder, nocookie iframe and a visible watch fallback. Chat stays plain links. Notes remain ordinary Markdown; bounded directives retain portable Markdown links. The existing Typst book keeps static directive thumbnails/times/links; ordinary links remain usable in its output.

## Changed files

| File | Change |
| --- | --- |
| `docs/INGEST.md` | Document canonical video ingest, dedupe and transcript timestamps. |
| `docs/UI.md` | Document ordinary-link players, supported forms, timing and rejection rules. |
| `docs/plans/2026-10-02-youtube-robust-report.md` | Record design, changes, verification, limitations and the memory handoff. |
| `server/src/agent/media-warnings.ts` | Detect missing watch links without accepting code, metadata, HTML or lookalike URLs as evidence. |
| `server/src/agent/tools.test.ts` | Cover missing video links and inert/hostile near misses in note-write warnings. |
| `server/src/ingest/detect.test.ts` | Cover video routing and non-video/lookalike rejection. |
| `server/src/ingest/detect.ts` | Route validated videos, including apex/mobile/music/nocookie URLs, to captions. |
| `server/src/ingest/ids.test.ts` | Verify watch/share/music/embed dedupe. |
| `server/src/ingest/ids.ts` | Canonicalize video forms and viewing parameters to one dedupe identity. |
| `server/src/ingest/youtube.test.ts` | Verify caption extraction across URL variants. |
| `server/src/ingest/youtube.ts` | Pass the validated video ID to the caption library. |
| `server/src/jobs/book-job.test.ts` | Verify the existing static book renderer retains URL-derived times and local thumbnails. |
| `server/src/jobs/draft-job.test.ts` | Verify source guidance, status-tool enforcement and repaired/unresolved revisions. |
| `server/src/jobs/draft-job.ts` | Supply registered URLs and timestamp guidance; block/revise missing source links. |
| `shared/src/media.test.ts` | Cover realistic URL shapes, encoded IDs, time forms, overrides and invalid near misses. |
| `shared/src/media.ts` | Centralize safe URL/ID/time parsing and directive overrides. |
| `skills/.defaults-history.json` | Register updated default skill hashes for existing-tree synchronization. |
| `skills/draft-chapter/SKILL.md` | Require actual video URLs and supported transcript locators during drafting/review. |
| `skills/find-sources/SKILL.md` | Teach specific video discovery, transcript inspection and exact registered URLs. |
| `skills/media-authoring/SKILL.md` | Prefer portable watch links; teach grounded moments, explicit segments and book behavior. |
| `skills/note-authoring/SKILL.md` | Require/preserve video watch links and supported timestamp citations. |
| `skills/source-summary/SKILL.md` | Preserve registered URLs and expose available transcript locators. |
| `web/src/components/Reader/MarkdownView.tsx` | Enable ordinary-link video processing in the reader. |
| `web/src/components/Reader/Reader.test.tsx` | Test link forms, layout, click-to-load privacy, dedupe and XSS rejection. |
| `web/src/components/Reader/YouTubeEmbed.tsx` | Validate component props and construct player/watch URLs only from validated values. |
| `web/src/components/Reader/remarkStudium.ts` | Add safe players for ordinary links, references and pasted URLs while preserving Markdown text. |
| `web/src/components/Reader/youtube-real-content.test.jsx` | Opt-in snapshot audit that renders existing notes, clicks players and collects failed links. |

## Tests and checks

First command: `pnpm install --frozen-lockfile --prefer-offline` — passed.

Final scoped coverage: **182 tests, 0 failures** (100 server + 43 shared + 39 web, including the snapshot audit). No full suite was run. Tests use fake caption providers, fake agents and temporary trees; no paid/provider smoke test was started.

```bash
pnpm --filter @studium/server exec vitest run src/ingest/detect.test.ts src/ingest/ids.test.ts src/ingest/youtube.test.ts src/ingest/library.test.ts src/jobs/ingest-job.test.ts src/jobs/draft-job.test.ts src/jobs/book-job.test.ts src/agent/tools.test.ts
# 100 pass / 0 fail, 8 files

pnpm --filter @studium/shared exec vitest run src/media.test.ts
# 43 pass / 0 fail

STUDIUM_YOUTUBE_AUDIT_ROOT="$(cat /tmp/studium-youtube-path)/audit" STUDIUM_YOUTUBE_AUDIT_REPORT="$(cat /tmp/studium-youtube-path)/real-content.json" pnpm --filter @studium/web exec vitest run src/components/Reader/Reader.test.tsx src/components/Reader/ReaderPassages.test.tsx src/components/Reader/youtube-real-content.test.jsx src/components/ChatDock/MessageMarkdown.test.tsx
# 39 pass / 0 fail, 4 files

STUDIUM_YOUTUBE_AUDIT_ROOT="$(cat /tmp/studium-youtube-path)/audit" STUDIUM_YOUTUBE_AUDIT_REPORT="$(cat /tmp/studium-youtube-path)/real-content.json" pnpm --filter @studium/web exec vitest run src/components/Reader/youtube-real-content.test.jsx
# Final audit-only run after improving failure collection: 1 pass / 0 fail

pnpm --filter @studium/server exec vitest run src/agent/tools.test.ts -t 'does not count inert|warns when a cited video'
# After the final TypeScript fence guard: 5 pass / 0 fail, 11 skipped

pnpm --filter @studium/server exec tsc --noEmit
pnpm --filter @studium/web exec tsc --noEmit
pnpm --filter @studium/shared exec tsc --noEmit
# All pass. A nullable-fence-marker type error in the first final server check was corrected.

pnpm --filter @studium/web build
# Pass; existing large lazy-chunk warning remains.

rtk proxy pnpm exec biome check $(git diff --name-only -- '*.ts' '*.tsx' '*.json') web/src/components/Reader/youtube-real-content.test.jsx
# Pass, 19 files

git diff --check
# Pass

node scripts/skill-history.mjs
# Pass; hashes registered and generated JSON formatted with Biome.
```

The new tests first reproduced 20 parser failures, 16 ordinary-link rendering failures and nine ingest/drafter-guidance failures before those fixes. Those red runs are baseline evidence, not outstanding failures or additional coverage.

## Existing-content audit and browser verification

Read `/home/krishna/learny/data/users/` without modifying it. There is one user tree. Copied it into `/tmp/studium-youtube-pl99z7fv/audit` for rendering and a separate disposable runtime under `/tmp/studium-youtube-pl99z7fv/state/users/yttester`. A final read-only hash comparison confirmed the audited live inputs had not changed.

- Rendered **all 13 existing chapter notes** through the actual `MarkdownView`. These notes currently contain **zero YouTube URLs**, so a chapter-only video check would be vacuous.
- Also rendered the **five parsed library files** containing YouTube URLs: **nine video-link occurrences** and **two channel-link occurrences**. Every video produced its expected player ID/time after Play; the Stanford link retained `#t=2385`. Channel pages remained links. **Failed video links: none.** No private note body was copied into this repository.
- The reusable audit is opt-in via `STUDIUM_YOUTUBE_AUDIT_ROOT`; optional `STUDIUM_YOUTUBE_AUDIT_REPORT` stores per-file results and failed URLs/reasons. Use a disposable snapshot, not the live data directory.
- `node /tmp/studium-youtube-browser.mjs` — **292 assertions passed** over **390×844** and **1440×900**, each in light and dark mode. Real form login and **76 real Play clicks** exercised the nine existing video links plus ten URL/syntax cases per combination. A real PCA chapter was also opened in each combination.
- Verified expected watch URLs, player IDs/start/end, nocookie host, referrer policy, allow list, no iframe or YouTube requests before Play, no raw-HTML iframe, no page errors and no horizontal overflow. Channel/lookalike/invalid links and code remained inert. Screenshot samples were visually inspected.
- The faux test server used port **3194**, an admin from environment variables and only temporary data/config. Saved PID **1359283** was stopped with SIGTERM; the server logged orderly shutdown. Earlier harness attempts failed because a background shell did not persist and the login wait used the compatibility endpoint; both harness issues were corrected before the passing run.

Artifacts:

- `/tmp/studium-youtube-pl99z7fv/real-content.json`
- `/tmp/studium-youtube-pl99z7fv/browser-results.json`
- `/tmp/studium-youtube-pl99z7fv/{390,1440}-{light,dark}-{95-video-matrix,96-existing-video-links}.md.png`
- `/tmp/studium-youtube-browser.mjs` and `/tmp/studium-youtube-browser.log`
- `/tmp/studium-youtube-{server-tests,shared-tests,web-tests,audit,build}.log`

## Deviations / not done / open questions

- Existing chapters contain no videos and the library has no registered video source. Expanded the real-content check to existing parsed source links and used fake registered-video fixtures for ingest/draft regression tests. Did not invent or backfill real chapter content.
- Third-party player responses were stubbed in browser checks after observing their requested URLs. YouTube playback, deleted/private videos, owner-disabled embedding and provider availability are not verified; the visible watch fallback remains available. Browser checks used Chromium; service-worker registration was suppressed for deterministic checks.
- Timestamp selection is taught from actual transcript markers; semantic selection by a live paid model was not exercised. Old sources without markers still use whole-video links; no new re-ingest UI was added.
- The book already exists. Its current media regression tests passed; no new PDF was compiled for this reader/URL fix.
- No unresolved implementation failure is known. No repository commits, pushes, branch changes, deployment, sub-agents, orchestration skills or modifications to AGENT_MEMORY.md, .env*, .claude/ or data/ were made. Local protected content stayed read-only.

## Five-line log for AGENT_MEMORY.md

```text
2026-10-02 youtube-robust (codex/yt): shared video URL/time parsing, ingest routing/ID captions and canonical dedupe fixed.
Reader embeds ordinary/pasted/reference links and directives safely; original Markdown stays readable and players load only on Play.
Drafter/rewrite/revision prompts and five skills use exact registered URLs/transcript times; missing links block checked status.
182 scoped tests pass; types/Biome/build pass; 292 browser assertions across 390/1440 light/dark; temp test PID stopped.
Real audit: 13 chapters have no videos; all 9 parsed-source video links render, 2 channel links remain links; external playback untested.
```
