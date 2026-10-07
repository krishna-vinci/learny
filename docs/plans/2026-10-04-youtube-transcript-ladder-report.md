# YouTube transcript ladder - implementation report

**Status:** ready_for_review. One item stays pending operator setup: a live,
timestamped transcript on this host (see Limitations).

**Worktree:** `/path/to/studium-worktrees/yt-ladder`, branch `codex/yt-ladder`,
baseline `ad39ab79173b4f84a361c5d3d618f1c8b0cb38ed`. No commits, pushes, merges,
dependency changes, or edits to `.env*`, `data/`, `.claude/`, or `AGENT_MEMORY.md`.
The root updated the plan and this report at acceptance. `docs/plans/2026-10-04-youtube-transcript-ladder-browser/`
holds the browser evidence.

## Final integration review

The root reviewed the implementation for specification compliance and credential,
subprocess, download, authorization, and retry safety, then sent one consolidated
correction bundle to the same native Flash worker. Its resumed correction completed
after one provider HTTP 400; no alternate worker model or external agent CLI was used.
The installed route is pinned to `commandcode/deepseek-v4.1-flash`; returned tool
metadata did not independently expose the actual inference model.

Three final issues were reproduced with focused failing tests and fixed by the root:

- Valid Netscape cookie rows with empty values now retain their trailing tab during validation.
- Abort errors from an engine or metadata fetch propagate as cancellation instead of producing an embed-only source.
- An env cookie re-export is fingerprinted before accepting an old run's success/stale outcome, even when no status request has refreshed the credential generation.

The four affected test files passed after these changes (71 tests). Final Biome
includes all new integration files (41 changed TypeScript files); formatting fixes
were limited to the new `server/src/youtube/` files.

## What the ladder does

Module -> anonymous yt-dlp -> signed-in yt-dlp -> embed-only. Every rung degrades
cleanly: the source is still written with oEmbed title/author and the
`i.ytimg.com` thumbnail, `type: video`, `parse_tier: basic`,
`transcript_status: blocked|unavailable|no-captions|disabled`, no parsed text, and
one plain-language `parse_warning`. Transcript markdown keeps the exact
`<!-- t:N -->` paragraph shape (integer seconds) whichever engine produced it.

## Correction round - all 10 items

1. **Anonymous never touches credentials.** `service.ts` splits
   anonymous (`#execute(..., null, ...)`, no decrypt, no copy, no `--cookies`) from
   signed-in (`CookieStore.withRunCopy` -> private 0600 copy -> `--cookies`).
   `SIGNED-IN` success calls `recordSuccess(videoId, generation)`. Credential
   state is refreshed (`#ensureCredentials`) before every ladder decision, not only
   in the constructor. Tests: anonymous run has no `--cookies` and leaves no copy
   dir; signed-in run passes a `mkdtemp` copy that is deleted and records
   `lastSuccess*`.
2. **Stale only with explicit evidence.** `classifyFailure` returns `blocked` for
   bot/sign-in walls and 429s, and `stale-cookie` only for
   `cookies ... expired|invalid|no longer valid|revoked|corrupt` shapes. Tests:
   bot wall with valid cookies stays `blocked`/not stale; explicit invalid cookies
   flip stale and notify admins exactly once per generation.
3. **Cookie store race/generation hardening.** `CookieStore` serializes every
   mutation and the initial load through one chain; outcomes carry the generation
   their run used and are ignored after replace/remove; `upload` resets
   last-success and notification state; env re-export is detected by a non-secret
   SHA-256 fingerprint, bumps the generation, clears stale/last-success, so a
   re-export heals without a restart; corrupt ciphertext reports `readable: false`
   instead of Configured. Validation now requires the header to be the first
   non-empty line, exactly 7 tab fields with valid domain/flag/path/secure/expiry/
   name, and accepts `#HttpOnly_` rows. Per-run and state temp files use exclusive
   `wx` creation with random names (`cookies.ts`, `update.ts`), and the update
   binary is chmodded before the atomic rename (no post-rename step). Tests:
   replace-while-run-pending, remove-while-run-pending, env re-export generation,
   corrupt ciphertext, HttpOnly rows, malformed rows, per-run copy deletion.
4. **Subprocess and cancellation safeguards.** yt-dlp runs with
   `--ignore-config --no-playlist --skip-download --no-cache-dir --no-plugin-dirs
   --no-remote-components --no-js-runtimes --js-runtimes node:<process.execPath>
   --no-warnings --proxy ""`, a private `mkdtemp` cwd, and a minimal sanitized env
   (PATH/HOME/TMPDIR/LANG/NO_COLOR only - no server secrets or proxy vars). Video
   ids are validated at the service boundary. Cancellation is honored through
   queue wait, spacing, retry delay, metadata/subtitle fetches, and the extractor
   (abort is rethrown, never converted into an embed-only source).
   **Spacing is enforced at every actual subprocess start** (including retries):
   `#waitForSpacing` runs inside `#execute`, and the retry path re-enters it, so a
   retry cannot start early and cannot push the next queued video inside the 2 s
   window. `attempt.retryable` gates the retry. Tests: two-attempt first video
   followed by a queued second video with all consecutive starts >= 2000 ms,
   non-retryable outcome runs once, queued abort starts no subprocess.
5. **Error and track correctness.** The extractor preserves the module's typed
   `disabled`/`unavailable` evidence, treats the generic not-available error as
   ambiguous/retryable, escalates on blank/cleaned-empty captions, and never lets
   an ambiguous engine failure overwrite explicit evidence. Track selection only
   accepts `json3`; an advertised track that yields no segments is
   `extraction-error` (retryable), not `no-captions`; non-English fallback prefers
   an explicit `*-orig` track. `json3.ts` keeps fractional-second offsets (the
   marker is floored at format time), restricts the credit regex to real credit
   syntax (`Subtitles by`, `Captions:`, `Transcribed by`, `Translator:`,
   `Reviewer:`, Amara/Otter/Rev domains), and no longer drops ordinary speech that
   merely starts with "Subtitles"/"Captions".
6. **Retry integrity.** The route requires a validated YouTube video URL; the job
   derives the canonical URL from the stored source and rejects a supplied URL
   whose video id differs; a malformed `retrySourceId` is rejected instead of
   silently becoming a normal add. Frontmatter is re-read inside the source lock
   after extraction, a concurrent successful transcript is never downgraded, a
   failed retry rewrites the body so the warning matches the new
   no-captions/disabled outcome, cancellation is checked before writes, new
   transcript files are written before the source metadata, only obsolete parsed
   files are deleted, and removals are committed (`commitPaths` uses `git add -A`).
   Tests: success keeps id/set links/added date and writes `<!-- t:843 -->`,
   mismatched URL rejected, concurrent upgrade preserved, warning/body refresh.
7. **User-visible acceptance.** `LibrarySourcePage` renders the click-to-load
   `YouTubeEmbed` (local thumbnail, `youtube-nocookie` iframe on click, Watch
   link) for every video source; admins get a `/settings/integrations` link on the
   source page and from Activity, members get "ask your admin"; `unavailable`
   keeps its own wording; Retry shows pending and failure feedback; the cookie
   panel clears the file input after an invalid upload too; `useYoutubeStatus`
   polls while stale and is invalidated by a finished ingest outcome. Activity now
   surfaces recently finished ingest jobs that carry a warning. Focused component
   tests: `IntegrationsSection.test.tsx` (basic -> Install -> improved, wrong-file
   friendly message + input cleared), `LibrarySourcePage.test.tsx` (player,
   admin link, member copy, unavailable wording, retry error),
   `ActivityPanelContent.test.tsx` (admin link, member copy).
8. **Unreadable videos are not evidence.** `resolveDraftSources` skips sources
   with `credibility: unreadable`, and the drafter gets an explicit "never cite a
   video that is not listed" instruction. Tests: `plan-sources.test.ts` excludes
   the embed-only video while keeping the readable source; `draft-job.test.ts`
   proves the blocked video id is absent from "Allowed source ids" and from
   selected passages (mixed set still uses the readable source).
9. **Invalid `YTDLP_PATH` recovery.** Discovery falls through to the managed copy
   and then PATH when the override is unusable, reports `envOverrideInvalid` plus
   `managedShadowed`, and never claims improved unless a binary is actually
   active. Tests: invalid override + managed copy -> managed found with
   `envOverrideInvalid: true`; everything missing -> `basic`.
10. **Browser QA**: real Playwright + `/usr/bin/google-chrome` run (below).

## Changed files (expanded)

Server - YouTube integration:

- `server/src/youtube/types.ts` - engine interface, normalized segment/failure types.
- `server/src/youtube/cookies.ts` - strict Netscape validation, encrypted atomic store, generation snapshots, env fingerprint re-export, `wx` per-run copies.
- `server/src/youtube/engine.ts` - resolve order + invalid-override fallback/flags, `execFile` runner with cwd/env/timeout/output caps.
- `server/src/youtube/update.ts` - official asset mapping, GitHub-only allowlist, `SHA2-256SUMS` verification, `wx` temp + chmod-before-rename.
- `server/src/youtube/json3.ts` - json3 -> segments, fractional offsets, restricted credit cleaning.
- `server/src/youtube/service.ts` - status/install/update, credential lifecycle, pacing at every start, retry gating, cancellation, track selection, oEmbed/thumbnail.
- `server/src/youtube/cookies.test.ts` - validation, encryption, lifecycle, cleanup and credential-generation race tests.
- `server/src/youtube/json3.test.ts` - timing, conservative cleaning and track-selection tests.
- `server/src/youtube/service.test.ts` - discovery, ladder execution, credential handling, cancellation and pacing tests.
- `server/src/youtube/update.test.ts` - official download, platform and checksum-preservation tests.

Server - wiring and behaviour:

- `server/src/ingest/youtube.ts` - ladder, typed module errors, blank escalation, cancellation.
- `server/src/ingest/types.ts` - `ExtractOptions.youtube`, `Extracted.unreadable`/`transcriptStatus` (narrow union).
- `server/src/ingest/library.ts` - video type for embed-only, `credibility: unreadable`, no parsed files, summary `transcriptStatus`.
- `server/src/ingest/safe-fetch.ts` - optional `allowedHosts` re-checked per redirect hop.
- `server/src/jobs/ingest-job.ts` - engine threading, skip-Librarian for unreadable, integrity-checked in-place retry.
- `server/src/jobs/draft-job.ts` - explicit instruction to cite only allowed readable sources.
- `server/src/inbox/plan-sources.ts` - unreadable videos excluded from drafting evidence.
- `server/src/routes/youtube.ts` - admin-only status, install/update and bounded cookie upload/removal endpoints.
- `server/src/routes/library.ts` - validated in-place transcript retry endpoint.
- `server/src/server.ts` - integration route registration and authorization wiring.
- `server/src/main.ts` - instance-key derivation and shared YouTube service creation.
- `server/src/workspaces/manager.ts` - service threaded into workspace ingest jobs.
- `server/src/ingest/safe-fetch.test.ts` - allowed-host checks on redirects.
- `server/src/ingest/youtube.test.ts` - each ladder rung, warnings, markdown compatibility and abort propagation.
- `server/src/jobs/ingest-retry.test.ts` - retry identity, URL validation, warning refresh and concurrent upgrade preservation.
- `server/src/jobs/draft-job.test.ts` - blocked videos absent from citation evidence.
- `server/src/inbox/plan-sources.test.ts` - readable-source filtering.
- `server/src/routes/library-retry.test.ts` - retry eligibility and route validation.
- `server/src/routes/youtube.test.ts` - upload/status secrecy and route behavior.
- `server/src/server.test.ts` - admin integration authorization regression test.

Shared/web:

- `shared/src/api.ts` - `YoutubeIntegrationStatus` (+`envOverrideInvalid`), narrow `YoutubeTranscriptStatus` on `SourceSummary`/`JobResult`.
- `web/src/api/client.ts` - admin YouTube and transcript retry HTTP calls.
- `web/src/api/queries.ts` - integration hooks, stale polling, ingest-outcome invalidation and retry mutation.
- `web/src/components/Settings/IntegrationsSection.tsx` - Install/Update, guided cookie upload and friendly status/errors.
- `web/src/components/Settings/settingSections.ts` - admin Integrations settings entry.
- `web/src/pages/LibrarySourcePage.tsx` - video player, admin/member guidance and retry feedback.
- `web/src/lib/youtube-warning.ts` - plain-language warning and retry eligibility helpers.
- `web/src/components/Activity/ActivityPanelContent.tsx` - warned finished jobs + admin Settings link.
- `web/src/components/Settings/IntegrationsSection.test.tsx` - basic-to-improved Install and friendly invalid-cookie upload tests.
- `web/src/pages/LibrarySourcePage.test.tsx` - player, warning, permissions and retry feedback tests.
- `web/src/components/Activity/ActivityPanelContent.test.tsx` - admin/member warning guidance tests.

Infra/docs:

- `Dockerfile` - pinned, checksum-verified `yt-dlp 2026.08.19` for linux x64/aarch64.
- `docs/INSTALL.md` - beginner setup steps, Docker note and optional cookie guidance.
- `docs/INGEST.md` - transcript ladder, unreadable-source contract and engine configuration.
- `docs/plans/2026-10-04-youtube-transcript-ladder.md` - implementation contract and acceptance record.
- `docs/plans/2026-10-04-youtube-transcript-ladder-report.md` - changed files, verification and operator handoff.
- `docs/plans/2026-10-04-youtube-transcript-ladder-browser/browser-results.json` - desktop/mobile browser assertions.
- `docs/plans/2026-10-04-youtube-transcript-ladder-browser/1440-settings-improved.png` - installed engine status screenshot.
- `docs/plans/2026-10-04-youtube-transcript-ladder-browser/1440-settings-bad-cookie.png` - friendly upload validation screenshot.
- `docs/plans/2026-10-04-youtube-transcript-ladder-browser/1440-source-player.png` - source player screenshot.
- `docs/plans/2026-10-04-youtube-transcript-ladder-browser/390-source-retry.png` - mobile retry feedback screenshot.

## Verification (exact commands, counts)

| Command | Result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/youtube src/ingest src/jobs/ingest-job.test.ts src/jobs/ingest-retry.test.ts src/jobs/draft-job.test.ts src/inbox/plan-sources.test.ts src/routes/library.test.ts src/routes/library-retry.test.ts src/routes/youtube.test.ts src/workspaces/manager.test.ts src/app.test.ts` | 30 files, **273 passed / 0 failed** |
| `pnpm --filter @studium/server exec vitest run src/server.test.ts` | 14 tests, **13 passed / 1 failed** - `gates default and positive plan drafts using the real approval route, while allowing zero` (`src/server.test.ts:404`). Reproduced with `server.ts` stashed to the baseline, so pre-existing and untouched. |
| `pnpm --filter @studium/web exec vitest run src/components/Settings src/components/Activity src/pages/LibrarySourcePage.test.tsx src/api/queries.test.tsx src/pages/LibraryPage.test.tsx` | 8 files, **18 passed / 0 failed** |
| `pnpm --filter @studium/web exec vitest run src/pages/settings-utils.test.ts src/lib` | 10 files, **56 passed / 0 failed** |
| `pnpm --filter @studium/shared exec tsc --noEmit && pnpm --filter @studium/server exec tsc --noEmit && pnpm --filter @studium/web exec tsc --noEmit` | exit 0 |
| `rtk proxy pnpm exec biome check server/src/inbox/plan-sources.test.ts server/src/inbox/plan-sources.ts server/src/ingest/library.ts server/src/ingest/safe-fetch.test.ts server/src/ingest/safe-fetch.ts server/src/ingest/types.ts server/src/ingest/youtube.test.ts server/src/ingest/youtube.ts server/src/jobs/draft-job.test.ts server/src/jobs/draft-job.ts server/src/jobs/ingest-job.ts server/src/main.ts server/src/routes/library.ts server/src/server.test.ts server/src/server.ts server/src/workspaces/manager.ts shared/src/api.ts web/src/api/client.ts web/src/api/queries.ts web/src/components/Activity/ActivityPanelContent.tsx web/src/components/Settings/settingSections.ts web/src/pages/LibrarySourcePage.tsx server/src/jobs/ingest-retry.test.ts server/src/routes/library-retry.test.ts server/src/routes/youtube.test.ts server/src/routes/youtube.ts web/src/components/Activity/ActivityPanelContent.test.tsx web/src/components/Settings/IntegrationsSection.test.tsx web/src/components/Settings/IntegrationsSection.tsx web/src/lib/youtube-warning.ts web/src/pages/LibrarySourcePage.test.tsx` | 31 files, exit 0 |
| `pnpm --filter @studium/web build` | built (222 precache entries) |
| `git diff --check` | exit 0 |

Final root checks after the three integration fixes (overlap the earlier server run; do not add these counts together):

| Command | Result |
| --- | --- |
| `pnpm --filter @studium/server exec vitest run src/youtube/cookies.test.ts src/youtube/service.test.ts src/ingest/youtube.test.ts src/jobs/ingest-retry.test.ts` | 4 files, **71 passed / 0 failed** |
| `pnpm --filter @studium/server exec tsc --noEmit && git diff --check` | exit 0 |
| `rtk proxy pnpm exec biome check --write server/src/youtube` | 10 files checked, 6 files formatted |
| `rtk proxy pnpm exec biome check $(git diff --name-only -- '*.ts' '*.tsx') $(git ls-files --others --exclude-standard -- '*.ts' '*.tsx')` | **41 files, exit 0** |

Setup ran first: `pnpm install --frozen-lockfile --prefer-offline` (exit 0).
No full-suite tests, Docker image build, real LLM calls, or paid setup checks were run.

## Browser QA (Playwright + Chrome, real clicks)

Script `/tmp/yt-ladder-browser.mjs` (uses
`/home/<username>/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs` and
`/usr/bin/google-chrome`), fresh `examples/sample-set` copy at
`/tmp/studium-qa3.buWr8N`, own port `4612`, `STUDIUM_FAUX=1`. Admin created via the
API, then the real login form; one real YouTube source
(`aircAruvnKk`) seeded through the ladder so the page has a real title, thumbnail
and blocked warning. The Install click fakes the download via route interception
(per the brief; the earlier round already proved a real verified download).

Both viewports (1440x900 and 390x844) asserted, with zero unexpected page/console
errors (the single 400 is the deliberate invalid-cookie upload):

- Settings -> Integrations: "Transcripts: basic" + Install -> click -> "Transcripts: improved (yt-dlp 2026.08.19)".
- Wrong `cookies.txt` -> the exact friendly validation message, and the file input is cleared.
- Source detail: blocked warning, admin "Set up YouTube sign-in" link to `/settings/integrations`, "Watch on YouTube", no iframe before click, then `https://www.youtube-nocookie.com/embed/aircAruvnKk?start=0...` after clicking "Play video".
- "Retry transcript" -> "Retrying in the background..." feedback.
- No horizontal overflow at either width.

Artifacts copied into the worktree at
`docs/plans/2026-10-04-youtube-transcript-ladder-browser/`
(`browser-results.json`, `1440-settings-improved.png`,
`1440-settings-bad-cookie.png`, `1440-source-player.png`,
`390-source-retry.png`). The full set (11 files, both viewports) is at
`/tmp/studium-qa3.buWr8N/scratch/`. The QA server was stopped with SIGINT; only
that process was started and stopped.

Earlier live evidence still stands from the first round: a real Install downloaded
`yt-dlp_linux 2026.08.19`, verified the published checksum, installed 0755, and
flipped the status to improved; adding two real videos without cookies produced
embed-only sources with real titles/thumbnails and the blocked warning.

## Limitations

1. **Live timestamped transcript pending operator setup.** This host's egress gets
   YouTube's bot attestation even through yt-dlp; with no cookie file the strict
   tier cannot be exercised here. Unit tests cover every rung and failure mode with
   fakes; the cookie unlock needs an operator-exported `cookies.txt`.
2. `resolveDraftSources` now excludes unreadable videos, but a set that contains
   only an unreadable video will fail drafting with the existing "no sources yet"
   message rather than a video-specific one.
3. Cosmetic: the blocked warning appears in the source header (with the Settings
   link and Retry action) and again in the agent-visible body. Both consumers need
   it; flagged for review rather than deduplicated.
4. Pre-existing `src/server.test.ts:404` failure, unchanged.
5. Docker's pinned download/checksum path was reviewed but the image was not built in this run.

## Decisions for the orchestrator

- Embed-only sources use `credibility: unreadable` and a new optional
  `SourceSummary.transcriptStatus`; both are additive.
- Retry reuses the ingest job with a validated `retrySourceId` (no new JobKind) and
  the stored URL is authoritative.
- `safeFetch` gained optional `allowedHosts`; defaults are unchanged.
- Docker pins `yt-dlp 2026.08.19`; the in-app Update tracks the latest release.

## AGENT_MEMORY.md handoff (5 lines - orchestrator to add)

1. YouTube ingest is a ladder: module -> anonymous yt-dlp -> signed-in yt-dlp -> embed-only; the source is always added, never aborted.
2. Anonymous runs never read/copy cookies or pass `--cookies`; only signed-in runs snapshot credentials, and yt-dlp always runs with `--ignore-config`, no ambient plugins/remote components, a private cwd and a sanitized env.
3. Engine discovery is `YTDLP_PATH` -> `<dataDir>/bin/yt-dlp` -> PATH; an unusable override falls back but is reported (`envOverrideInvalid`), and spacing is enforced before every subprocess start including retries.
4. Cookie state is generation-based and race-safe: env re-exports bump the generation and clear stale, stale only flips on explicit invalid/expired-cookie evidence with one admin notification per generation, and untranscribed videos are excluded from drafter evidence.
5. Gotcha: `server/src/server.test.ts:404` fails on the baseline; this host's IP is YouTube-walled even with yt-dlp, so live timestamped transcripts await operator cookies.
