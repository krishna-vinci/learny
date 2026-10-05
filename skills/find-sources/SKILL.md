---
name: find-sources
description: Find, evaluate, and register sources suited to the learner's study plan.
---

# Find-sources procedure

## Establish the research brief

1. Read the set's `PLAN.md` and relevant `library/*/source.md` entries.
2. Identify the missing concepts, the plan's `level`, and any required library version or publication date.
3. Reuse registered sources when they already cover the brief.

## Choose tools by material

MCP names follow `mcp_<server>_<tool>`, with non-alphanumeric characters replaced by underscores. Long or colliding names may have a hash suffix; use the tools actually available rather than guessing a name.

- **Papers:** use `mcp_papers_*`, such as `mcp_papers_search_papers`, `mcp_papers_search_arxiv`, `mcp_papers_search_semantic`, or `mcp_papers_read_arxiv_paper`. Prefer arXiv or Semantic Scholar records; check venue, year, peer-review status, and citations. An arXiv preprint or a high citation count alone does not establish peer review.
- **Library/API documentation:** use `mcp_context7_*` to resolve the library id, then retrieve the docs. Note the version checked and prefer documentation matching the learner's version.
- **General topics:** start with `wiki_search` and `wiki_read` for orientation, then use `web_search` with the recipe slot to find specific sources; use `mcp_searxng_*` when native search is unavailable. Search results are discovery leads, not evidence.

If a tool is unavailable, say which check could not be performed and report specific candidate URLs to the owner. The Librarian may lack research tools; do not claim a search or fetch occurred.

## Evaluate and register

1. Read candidate pages with `web_fetch` before recommending or citing them. It renders through Firecrawl when configured; inspect the returned text rather than relying on snippets.
2. Check authorship, authority, date, scope, text quality, and fit to the plan's level. For papers, compare the claim with the actual paper, not only its abstract or search record.
3. Anything to be cited must be registered with `add_source`, then read under `library/<source-id>/`. If the role lacks `add_source`, report the URL and reason to the owner for registration. Wait for a real registered id; never cite unregistered material or invent an id.
4. Apply the `source-summary` credibility tiers exactly:

- `A`: peer-reviewed or canonical; include publisher/edition, peer-review status, or canonical-maintainer evidence.
- `B`: reputable secondary material, official documentation, university lectures, or a stable encyclopedia article.
- `C`: identifiable expert but informal; name the expertise and why it is credible.
- `D`: unverified or unknown provenance; say what must be checked before relying on it.

If `web_fetch` is unavailable or the text cannot be read, mark the candidate unverified and ask the owner to supply or ingest it. Do not present it as checked evidence.

## Return a short ranked list

For each source, give its title and URL, credibility tier with a source-specific reason, concepts covered, and why its depth fits `PLAN.md`'s level. Include publication year or library version where relevant, and state whether registration is complete or pending. Cite registered material as `[^src:<id>]`; pending URLs are proposals, never support for a factual claim.

For YouTube discovery, search for a specific lecture/demo covering the concept and
prefer a named educator or institution. A channel/playlist page is not a video URL.
Register the actual watch/share/shorts URL, then inspect the ingested transcript
before selecting it as evidence. Once registered, copy its exact `source.md` URL;
use transcript `<!-- t:N -->` markers for moments and never guess IDs or times.

## Recipe scouting (D34)

Load `references/recipes.md` for subject × level slots before searching. Use
10–20 candidates per slot; rank with `scout_sources` when available. The supplied
score/reason is your LLM judgment if the classifier is off/shadow. Fetch top text
candidates and keep those above parse-health 65 with substantive text; reject thin
SEO pages. Do not repeatedly fetch a host already blocked in this job/chat. On
paywalls seek an open copy or a textbook/explainer. Domain outcome history is a
bounded hint, not authority. Report breadth, selected/dropped candidates and gaps.
