# Ingest Pipeline

Locked 2026-09-28 (D17). Owner: Librarian role (D15). Output: `library/<src-id>/` (D14).

## Entry points

1. Chat — paste URL / attach file; Tutor calls the ingest tool.
2. UI — "Add source" dialog (drag-drop or URL).
3. Folder — files dropped in `library/_inbox/` are picked up by a watcher.

All run: **detect → dedupe → fetch → extract → clean → register**.

## Routing

| Input | Basic (built in) | Advanced (by env, never shipped) |
|---|---|---|
| Papers (arXiv, DOI, PubMed, …) | paper-search MCP `search_*` → `download_*` → PDF route | — |
| PDF | unpdf text layer | MinerU (`MINERU_URL`) when quality check fails |
| EPUB | unzip XHTML → turndown | |
| DOCX / PPTX | mammoth / officeparser | MinerU |
| Web page | readability → turndown | Firecrawl (`FIRECRAWL_API_URL`, `FIRECRAWL_API_KEY`) |
| Wikipedia | REST API → MD | |
| YouTube | captions | |
| Image | Librarian model, if it accepts images | |
| Audio | Librarian model, if it accepts audio | |
| MD / TXT / HTML | direct | |

- Papers: Scout may skim with the MCP's `read_*` tools; ingestion always downloads the
  PDF and runs our pipeline (consistent quality, page anchors, dedupe). Sci-Hub source off.
- Image/audio: capability comes from model metadata; if unsupported, the app says so.
  No separate OCR or speech-to-text component (Whisper parked).
- SearXNG (`SEARXNG_URL`) is used by Scout for search, not by ingest.

## PDF quality check (deterministic)

Per page: characters per page, share of garbage/replacement characters, math-glyph
density. Result `good` → keep basic; `poor` → MinerU, or a warning if `MINERU_URL` is unset.

## Cleanup

- Deterministic code: de-hyphenate line breaks, strip repeated headers/footers,
  normalize headings.
- The LLM never rewrites extracted text. Librarian reads headings + section openings to
  write the `source.md` summary and TOC (cheap model).

## Splitting

Under ~50 KB → `parsed.md`. Larger → `parsed/NN-slug.md` split by top-level heading; the
TOC in `source.md` maps sections to files.

## Page anchors

Extractors keep `<!-- p:42 -->` markers. Citations may target a page:
`[^src:lib-strang-la#p42]`; the reader links to the original.

## Credibility tiers

| Tier | Meaning | Examples |
|---|---|---|
| A | peer-reviewed / canonical | papers, textbooks from established publishers |
| B | reputable secondary | Wikipedia, official docs, university lectures |
| C | known expert, informal | well-known educators, expert blogs |
| D | unverified | unknown web pages, personal notes |

Assigned by Scout/Librarian; user can override. Checker requires A/B support for
claims central to a chapter.

## Dedupe

sha256 (files), normalized URL, DOI / arXiv id. A hit links the existing library entry to
the set instead of re-ingesting.

## Long jobs

MinerU runs through its async task endpoint as a background job with progress in the jobs
panel.

## Privacy

Originals are never sent to a cloud parser by default. LLM providers see the text agents
read — stated in the docs.
