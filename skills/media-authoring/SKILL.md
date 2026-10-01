---
name: media-authoring
description: Add purposeful, local visuals to Studium notes with a static form for the book.
---

# Media authoring

Use at most one visual per main idea. Use none when text is clearer.

| Idea | Visual |
| --- | --- |
| Process or flow | Mermaid |
| Geometry, vectors, labelled structure | SVG figure |
| Numbers, functions, comparisons | Vega-Lite |
| A parameter to vary or steps to play through | Interactive artifact |
| A real-world demo or lecture moment | YouTube |
| A figure from the cited source | Saved image |

All file paths in notes are relative to the note: `notes/03-svd.md` uses
`![Projection](../assets/projection.svg)`. Keep files within this set.
Raw HTML in a note is blocked. Media in chat is links and local images only.

## SVG figures

Write `assets/<name>.svg` with `study_create`/`study_edit`. Include `viewBox`, no
fixed width, `currentColor` plus one accent, and text at least 14px. No scripts,
foreignObject, event handlers, external references or imports. References may use
`#…` or `data:` only. Stay within 300 KB. Embed with descriptive alt text as the
caption and cite the source with a footnote.

## Source images

First inspect the cited source's `library/<id>/images.json`; use searxng's `images`
category only as a fallback. Call `save_asset` with this set, an HTTPS URL, a
kebab-case name without an extension, alt text, and `sourceId`. Paste the exact
returned Markdown and retain the credit sidecar. Cite the source in the note.
Only PNG, JPEG, GIF and WebP may be downloaded; SVG is agent-written only. No AVIF.
Downloads are limited to 5 MB and 6000×6000 pixels; all assets in a set to 50 MB.

## YouTube moments

Use only library videos: add the source first so its transcript is ingested. Choose
`start` from the `<!-- t:843 -->` paragraph you used, in integer seconds, and cite
`[^src:<id>#t843]` with a footnote definition. Embed the leaf directive with no space
before its attributes:

```md
::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900}
```

The app shows a local thumbnail until the learner taps Play; the book shows the
thumbnail, time and link. Bare URLs remain links. Re-ingest of old videos is not
currently available; do not invent timestamps missing from a transcript.

## Data charts

Use a `vega-lite` JSON fence with inline `data.values` only. No URLs, named datasets,
image marks or external resources. For example:

```vega-lite
{"data":{"values":[{"step":"A","value":2},{"step":"B","value":4}]},"mark":"bar","encoding":{"x":{"field":"step","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}
```

The app renders a theme-aware SVG and the book renders a light SVG. If the spec is
invalid, its code stays readable. Mermaid stays a diagram-in-the-app caption in the
book until the later mmdc work.

## Interactive artifacts

Write one self-contained `artifacts/<name>.html`, at most 300 KB, using only inline
CSS/JS and data images/fonts. No network or external fonts; the sandbox blocks them.
Make it usable at 360px with touch and respect `prefers-color-scheme`. Always also
write `artifacts/<name>.svg`: a poster of the key frame, following the SVG rules.

```md
::artifact{src="../artifacts/projection.html" poster="../artifacts/projection.svg" title="Explore projection"}
```

The learner must tap Run. The book uses the poster and tells them to open the
chapter in Studium. Check write warnings for missing files and register sources
before using them. Do not put media in Anki cards: `.apkg` does not pack media files.
