---
name: source-summary
description: Produce a concise, useful source registry summary, table of contents, and credibility tier.
---

# Source-summary procedure

## Read enough to characterize the source

1. Read the extracted `parsed.md` or every file under `parsed/`. Skim top-level headings and opening paragraphs first; read closely where heading order is unclear.
2. Preserve the extractor's structure and page markers. Never rewrite the parsed text while writing the summary.
3. Identify the work's subject, intended audience, structure, `parse_tier` in `source.md`, and any parsing warning. Check the text quality, including broken words, missing sections, and damaged formulas; a successful parse alone is not evidence of readable text.
4. If parsed content is empty or obviously garbled, say so in `source.md`, lower the credibility tier to reflect the unusable evidence (unless the user has overridden it), and flag the source for re-ingest. Do not summarize junk or invent content from title or URL; write a quality warning instead.

## Write the summary

Write a summary of at most 200 words in the body of `library/<source-id>/source.md`. Include:

- what the source covers;
- its depth or audience;
- its strongest chapters/sections for this app;
- any major gap, bias, obsolete area, or accessibility problem;
- whether it is canonical, secondary, expert informal, or unverified.

Be concrete. "A university-level introduction that proves results and includes exercises" is useful; "a comprehensive resource" is not.

## Build the table of contents

Map every parsed file and significant top-level section:

```md
| Section | Location |
|---|---|
| 1. Vectors and vector spaces | parsed/01-vectors.md |
| 2. Matrix factorizations | parsed/02-factorizations.md |
| Chapter 3, pages 120–145 | parsed/03-svd.md |
```

For one `parsed.md`, use heading names plus page anchors when available. For split files, include every file. Keep the table navigable rather than exhaustive at every subsection.

## Assign credibility

Use exactly one tier with a one-line reason in the frontmatter:

- `A`: peer-reviewed or canonical; include publisher/edition, peer-review status, or canonical-maintainer evidence.
- `B`: reputable secondary material, official documentation, university lectures, or a stable encyclopedia article.
- `C`: identifiable expert but informal; name the expertise and why it is credible.
- `D`: unverified or unknown provenance; say what must be checked before relying on it.

The reason must be source-specific. Prefer `credibility: C # named educator with course-site lecture notes` over an unexplained letter. If the user has overridden the tier, preserve it and do not silently change it.

## Format formulas

Write every formula as LaTeX math: inline in `$…$` and display in `$$…$$`. Never leave
math bare: no standalone `*` or `^` outside dollar signs, and no Markdown emphasis
(`*`, `_`, `**`) inside a formula. Keep symbols inside the delimiters as LaTeX
(`$Av = \lambda v$`, `$x^2$`, `$a*b$`), not as prose or plain text.

## Complete the registry entry

Use the `source.md` frontmatter contract: stable id, title, authors, type, optional URL, credibility, parse tier, checksum when supplied, and added date. Keep the id and original registered URL unchanged. For video sources, mention usable transcript timestamp markers in the summary/TOC when present, so drafters can locate moments; never invent timestamps or replace the video URL with a channel or search result. The body contains the summary and table of contents.

## Review

1. Confirm the summary is at most 200 words.
2. Confirm every TOC location exists.
3. Confirm the credibility reason matches the evidence.
4. Confirm no credentials, private tokens, or long copied passages were added.
