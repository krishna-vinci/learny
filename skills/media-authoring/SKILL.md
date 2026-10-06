---
name: media-authoring
description: Create local figures and chapter Visuals, with static fallbacks for the book.
---

# Media authoring

Use at most one visual per main idea. Use none when text is clearer.

| Idea | Visual |
| --- | --- |
| Process or flow | Mermaid |
| Geometry, vectors, labelled structure | SVG figure |
| Numbers, functions, comparisons | Vega-Lite |
| A parameter to vary or steps to play through | `make-visual` widget or sketch |
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

When a chapter uses a registered YouTube source, surface that video near the concept
it supports. Read its `source.md` and relevant parsed transcript first. Copy the
actual registered URL/video ID; never copy an example ID, invent a URL, or replace
the source with an unrelated search result. If a new video is needed, discover it
with `find-sources`, register it with `add_source` when available, and wait for a
usable transcript; otherwise report the proposed URL for registration.

Prefer a descriptive ordinary Markdown link: it works in Studium, Obsidian and
GitHub. The reader adds a click-to-load player beside video links, including bare
watch/share/shorts/embed/mobile/music URLs. Channel and playlist links stay links.

For each video source used, include at least one link. Choose the time from the
`<!-- t:843 -->` marker of the transcript paragraph supporting the nearby concept.
Use integer seconds in the URL and a timestamp citation with a defined footnote:

```md
[Watch the projection example at 14:03](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=843s)

The projection keeps the component along the line.[^src:lib-video#t843]

[^src:lib-video#t843]: Channel, *Lecture title*, at 14:03.
```

These IDs and times are syntax examples, never source suggestions. If the transcript
has no timestamp markers, link the whole registered video and cite `[^src:<id>]`;
do not invent a time. Omit `end` unless the transcript supports that boundary.

For an explicit segment, use the existing leaf directive with no space before its
attributes. Keep a descriptive Markdown link beside it for portability:

```md
::youtube{src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" start=843 end=900}
```

The app uses a local thumbnail or placeholder until Play; no request to YouTube
occurs before that tap. The existing Typst book shows directive thumbnails, times
and links; ordinary Markdown links remain readable timed links in the book.
Old ingests may lack timestamp markers; use Retry transcript in the Library.
Before finishing, check every used video source has its correct link and review
write warnings for missing watch links or unregistered directive videos.

## Data charts

Use a `vega-lite` JSON fence with inline `data.values` only. No URLs, named datasets,
image marks or external resources. For example:

```vega-lite
{"data":{"values":[{"step":"A","value":2},{"step":"B","value":4}]},"mark":"bar","encoding":{"x":{"field":"step","type":"nominal"},"y":{"field":"value","type":"quantitative"}}}
```

The app renders a theme-aware SVG and the book renders a light SVG. If the spec is
invalid, its code stays readable. Mermaid stays a diagram-in-the-app caption in the
book until the later mmdc work.

## Interactive visuals

Load `make-visual` for built-in widgets, bundled-runtime sketches, stories and their
static book forms. It owns all interactive authoring guidance. New files go in
`visuals/`, attached by standalone `::visual{…}` at the chapter end. Existing
`::artifact`/`artifacts/` files and declarations keep working; preserve them on edits.
Prose must stand alone. Chat keeps plain links; Anki media remains deferred.


## Video moments that teach (D34)

Video beats text for motion/process, physical demos/labs, spatial manipulation,
a teacher working a problem step by step, pronunciation/language, real/historical
footage, performance and practical skills. Skip definitions, lists and text-heavy
facts that prose already teaches as well. One moment per concept at most.
Search the registered transcript sections for the concept; use the best matching
`<!-- t:N -->` marker. Put `::youtube{src="<exact registered URL>" start=N end=M}`
immediately after the supporting paragraph, with its `[^src:id#tN]` citation and
human footnote. Start at or after that marker within its section; end no more than
180 seconds later. Never use a video at the top as decoration. Do not invent times.
For blocked/no-transcript videos, use a “Watch” link and a muted line saying no
transcript is available; never cite, quote or summarize it as claim evidence.

## Chapter media plan (D36)

Read the supplied chapter media brief (or `<set>/media/NN-slug.md`) before authoring.
Realise each planned visual using the candidate figures or data tables; cite the
registered source for every source-derived chart/widget/redraw. Put the brief's
hidden `<!-- media:visual-N -->` marker immediately before its image, Mermaid/Vega
fence or standalone `::visual`/`::artifact` declaration. These ids never appear in
visible prose. If one cannot be made, write
`<!-- media:visual-N unavailable: concrete reason -->` followed by one muted
learner-facing line explaining the absence. Silent omissions block checking.

`library/<id>/images.json` v2 stores local `figures/` paths, original URL, alt,
caption, section, license (when known), and credit; legacy remote-only entries
remain readable. Inspect the local source figure before using or redrawing it.
Embed source rasters with explicit CC BY/BY-SA, CC0 or public-domain permission.
CC BY-NC and BY-NC-SA are allowed for personal non-commercial study when the
instance setting `media.allowNonCommercial` is true (the default). CC BY-ND and
BY-NC-ND require the original unmodified file: never crop, edit or re-encode it.
Unknown/all-rights-reserved images must be linked or replaced with an original
cited schematic, never embedded. Use `save_asset` with the chosen URL, sourceId
when present, name and alt. Paste its exact Markdown including the `Credit:` title;
the sidecar keeps creator, licence, licence URL, source page and the saved hash.
When tools are unavailable, return the complete redraw/credit or explain why a
permitted local copy cannot be saved; never claim a missing asset exists.

Use the brief's chosen video near its supporting concept, with its observed
transcript moment. Watch-only videos count as a quality video but get only a Watch
link and an honest no-transcript line, never claim evidence or invented times.

## Real images that teach (D37)

Prefer an actual photograph for monuments, artefacts, materials, organisms,
instruments, historical scenes, and the real appearance of an object. A photo
lets the learner recognise the real thing; an SVG explains its structure or
mechanism. Keep SVG construction unchanged for schematics. Never redraw a photo
when the brief has selected a suitable licensed real image.

Read the brief's `images` slots. For each chosen raster, call save_asset and put
`<!-- media:image-N -->` immediately before the returned Markdown at the paragraph
where that concept is taught, not in a gallery or at the top as decoration. Add a
short caption telling the learner what to notice. Preserve the returned Credit
title so the reader and book print creator, licence and source. Do not treat an
image licence as evidence for historical/scientific claims: those still need
registered-source citations. If no candidate fits or downloading fails, add
`<!-- media:image-N unavailable: concrete reason -->` and a muted learner-facing
explanation. Silent omissions, missing sidecars/credits, restrictive licence
reuse or modified ND images block checking. With tools unavailable, return exact
credit/placement instructions and explain that the local asset cannot be saved.
