# M4-6 — Import a documentation site (Firecrawl map → selected ingest)

You are the IMPLEMENTER in /path/to/studium-worktrees/m4-6 on branch codex/m4-6 (a git worktree of /path/to/studium). Do not load orchestration skills and do not spawn sub-agents. Read `AGENT_MEMORY.md` (in your worktree) first, then `docs/plans/2026-09-30-m4-study-loop.md` (your task row and the Decisions table).

Rules:
- Never commit or push. Never edit `AGENT_MEMORY.md` anywhere: put your 5-line log entry in the final report.
- Never touch `.env*`, `data/`, `.claude/` or `web/` (UI comes from Sonnet).
- Only stop processes you started (save `$!`); never pkill or killall.
- Targeted tests per AGENTS.md, in tmp dirs.
- Run biome as `rtk proxy pnpm exec biome check <files>`.
- If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising.
- Standing permission: minimal integration edits your task forces (imports, route mounts in `server/src/app.ts`, job registration in `server/src/workspaces/manager.ts`, type unions in `shared/src/api.ts`, the jobs route validator). List each one in the report.

End with the AGENTS.md final report plus the log entry.


## Goal
The learner pastes a docs-site URL, sees its pages, picks the ones they want, and each becomes a library source. Decision 5: at most 100 URLs per import, and at most 3 ingest jobs running at once for the import.

## Pieces
1. `server/src/ingest/firecrawl.ts`: add `firecrawlMap(url, {baseUrl, apiKey?, search?, limit?, signal?})` → `POST <base>/v2/map` with `{url, search?, limit, includeSubdomains: false, ignoreQueryParameters: true}`, returning `{url, title?, description?}[]` (check the v2 response shape against the running instance at `http://127.0.0.1:3002`).
   - Reuse the same trusted-endpoint fetch as `firecrawlScrape`: plain fetch, timeout, cap, `redirect: "error"`, and `firecrawlScrapeEndpoint`-style base normalization.
   - The site URL goes through `assertPublicUrl`. Every returned URL is filtered to the same registrable host as the input (drop others) and re-checked with `assertPublicUrl` before import.
2. Routes in `server/src/routes/library.ts`. Mind the AI gate: ingest summarises with AI, so the existing gate on `POST /api/library` must cover `site-import` too. Update `aiRouteDisabled` in `server/src/server.ts` if needed.
   - `POST /api/library/site-map {url, search?, limit? ≤ 500}` → `{pages:[{url,title,description}]}`. 400 when Firecrawl isn't configured (`FIRECRAWL_API_URL` unset), with a clear message.
   - `POST /api/library/site-import {urls: string[] (1–100), set?: string}` → validates each URL, then enqueues one `ingest` job per URL through the existing ingest path (the same input shape `POST /api/library` uses), throttled with at most 3 of this import running at once. Implement it as a small queue that enqueues the next when one finishes (subscribe to the workspace hub `{type:"job"}` events), or as one parent job `site-import` that runs children sequentially in threes; pick the simpler, correct option and document it.
   - Returns `{queued: n, skipped: [{url, reason}]}`. Duplicates of existing library sources are skipped (the library's dedupe already exists; reuse it).
3. `shared/src/api.ts`: request and response types.

## Tests
- `firecrawlMap`: stubbed fetch, shape parse, host filtering, private URLs dropped
- routes: 400 without Firecrawl, 101 URLs → 400, dedupe skip, throttling (at most 3 concurrent, with a stub ingest handler), AI-disabled user → 403

Run:
- `pnpm --filter @studium/server exec vitest run src/ingest/firecrawl.test.ts src/routes/library.test.ts src/server.test.ts src/jobs`
- `tsc`
