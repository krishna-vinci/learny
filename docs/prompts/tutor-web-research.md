# Tutor web research that actually happens, visibly

Work in your own worktree/branch; don't commit, push or merge. Read `AGENTS.md`, `AGENT_MEMORY.md`, `docs/PRINCIPLES.md`, `docs/decisions/LOG.md` (D19 security, D33 classifier) first. If something doesn't fit the code, stop that item and report file:line.

## Problem (evidence)
Learners get notes-only answers with no sign of whether the web was used, skipped, or failed.
- Research is opportunistic, not reliable. Chat logs show the tutor sometimes searches (polymers chats: 12, 6, 4 `searxng_web_search` calls; Hyderabad: 7) and sometimes never does for questions the set can't answer.
- `buildTutorPrompt` (`server/src/agent/prompt.ts`) never says when to research or how to cite the web.
- The quick-answer gate in `server/src/agent/chat-service.ts` (≈ :496 `enable_research`, :672 intent, :720 hint) strips research tools when `tutor.intent` is `on`. It's in **shadow** for the current user (all 5 logged decisions `fallback`), so it isn't the cause today, but it would be the moment someone turns it on.
- Failures are silent: an unavailable MCP server, SearXNG or Firecrawl error looks the same to the learner as "didn't need the web".
- General web search exists only through the SearXNG MCP (a spawned `npx` process) and Wikipedia. Firecrawl's `/search` is unused (`server/src/ingest/firecrawl.ts` implements scrape + map only). The owner's self-hosted Firecrawl uses SearXNG as its search backend, so its `/search` works on this deployment.

## Goal
A question that needs knowledge beyond the set gets real web evidence, and the learner can always tell where an answer's evidence came from: their notes/library, the open web, or "web research was needed but failed/unavailable (why)". Simple questions stay fast.

## Rulings (orchestrator)
- **Research tools are never stripped.** The quick-answer route may trim set *context*; research tools stay available every turn. Remove the `enable_research` escalation dance. The classifier may still *hint* that a question likely needs research.
- **Add a first-class `web_search` builtin now** for research roles (tutor, drafter, librarian/outliner where they research). Backends in order: Firecrawl `/search` when `FIRECRAWL_API_URL` is set and answers; otherwise SearXNG's JSON API at `SEARXNG_URL`; otherwise a clear "web search unavailable" result. Env-gated like scrape; no new dependencies. The SearXNG MCP stays for roles that already use it, but the tutor's guidance points at `web_search` + `web_fetch`.
- **Visibility bar:**
  - Every tutor answer that used, needed or failed research carries a compact provenance line: "From your notes", "Used the web · N sources" (expandable list of links), or "Web search unavailable: <reason>" / "Web search failed: <reason>".
  - Research tool chips show failures distinctly (not just a neutral chip).
  - Web-sourced claims in the answer link to their URL.
  - When the set can't answer and research failed or is unavailable, the answer says so in words; it never silently falls back to model memory as if grounded.

## Hard constraints
- Untrusted-evidence rule unchanged: search results and fetched pages are passed as untrusted data blocks (`server/src/agent/passage.ts` pattern), never as instructions.
- Every URL fetched from a search result goes through the existing guard (`assertPublicUrl`/`safeFetch`, redirects re-checked). Firecrawl stays the trusted endpoint it is today.
- No new dependencies. Tests use fakes; no network.
- Don't change how the classifier's other decisions behave.

## Verify
- Unit tests: backend selection and fallbacks (Firecrawl ok / Firecrawl error → SearXNG / none → unavailable), SSRF rejection of a private result URL, provenance states, and that research tools are present on a quick-answer turn.
- A scripted chat replay with a stubbed model: "what's the latest …" asks → `web_search` called → provenance "Used the web"; search failing → provenance "failed" plus a sentence in the answer.
- Browser check (real clicks, 390×844 and 1440×900): provenance line, failure chip, link list.
- Scoped tests, `tsc --noEmit` for server/web/shared, web build, biome on changed files. Report: changed files, tests with counts, deviations, a 5-line log entry.
