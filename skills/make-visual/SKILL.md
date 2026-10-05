---
name: make-visual
description: Add a readable teaching visual by filling a validated widget or bundled sketch template; use no visual when it adds no value.
---

# Make one teaching visual

Choose one concept. The prose must still make sense without the visual.
Default to a widget or Vega-Lite chart. Use a sketch only when no widget fits.

## Decision table — use the first matching row

| Concept | Form | Copy this reference |
| --- | --- | --- |
| Nothing spatial, quantitative or sequential to explain | None | Keep the text |
| Equation or parameter changes a curve | Widget | `templates/function-plot.json` |
| Matrix changes space; singular value decomposition | Widget | `templates/matrix-transform.json` |
| Algorithm, grammar transformation, process or small graph | Widget | `templates/step-through.json` |
| Events or eras on a dated axis | Widget | `templates/timeline.json` |
| Compare measured categories or a fixed data series | Vega-Lite | `media-authoring` chart example |
| Labelled structure with a parameter; no widget fits | SVG sketch | `templates/svg-labelled-diagram.html` |
| Spatial changes need narrated scenes; no widget fits | SVG story | `templates/svg-story.html` |
| Continuous motion explains a relationship; no widget fits | p5 sketch | `templates/p5-animation.html` |
| Custom data interaction unavailable in Vega-Lite/widgets | D3 sketch | `templates/d3-chart.html` |

Static figures, Mermaid, photos and video belong to `media-authoring`.
Read `references/subjects.md` for concrete ideas matching the PLAN subject.

## Copy, fill, check

1. Read the section and its cited evidence. Name the one idea the visual teaches.
2. Load the chosen complete template using `load_skill_reference`.
   On runtimes without that tool, open the same file in this skill's references folder.
3. Copy it; change only marked `/* FILL: … */` slots in HTML.
   JSON cannot contain comments: its fill slots are listed in `references/fill-slots.md`.
   Keep JSON valid; never paste comment markers or invent schema fields.
4. Fill realistic values and short labels, with units. Keep the example defaults usable.
   Consult `references/widgets.md` only for additional supported fields.
5. For sketches, copy the matching `.svg` template and change its marked title,
   labels and geometry to match the default draw. Stories have one poster per scene.
   Keep filename references in the header and chapter declaration in sync.
6. Write through the study tools, fix every hard validation error, then read warnings.
   Missing poster files can warn until the matching SVG is written.
7. Append one standalone declaration after the chapter's prose and footnotes:

```md
::visual{src="../visuals/stretch.json" title="How the matrix stretches space"}
::visual{src="../visuals/chain.html" poster="../visuals/chain.svg" title="Count repeat units"}
```

Write JSON/HTML/SVG into `<set>/visuals/`; paths above are note-relative.
A sketch MUST set `poster` on the declaration as well as its JSON header.
No registry heading; no declarations inside lists, quotes or callouts.
Preserve existing `::artifact` declarations and their files.

## Checklist before finishing

- [ ] Exactly one concept; one useful interaction or narrated comparison.
- [ ] Labels and units are readable at 360 px; labels fit their reserved space.
- [ ] Widget numbers/ranges/scenes are valid; equations use declared parameters.
- [ ] HTML has a valid `studium-visual` header and `studium.mount({draw})`.
- [ ] Every used bundled library is declared; no unused library is declared.
- [ ] Theme comes from the draw argument, with fallbacks; colours use `studium.palette`.
- [ ] SVG has `viewBox`; canvas resizes to the stage; no fixed CSS pixel width.
- [ ] No fetch, XMLHttpRequest, WebSocket, dynamic imports or external script tags.
- [ ] Runtime owns time and play state; no timers/private animation loops.
- [ ] Reduced motion starts paused; runtime scene controls are not duplicated.
- [ ] Poster SVGs exist, match the default/scene states, and contain no scripts,
      event handlers, foreignObject or external resources; each file ≤300 KB.

## Mistakes and fixes

| Mistake | Fix |
| --- | --- |
| `theme.palette[0]`, `theme.text`, `theme.background` | Use `studium.palette[0]`; documented fields are `fg`, `bg`, `muted`, `accent`, `grid`, `font` with fallbacks |
| Long text spills beyond the SVG | Keep the template's wrapping/shrinking helper; shorten labels, put detail in narration |
| `d3`, `p5` or `THREE` is undefined | Declare its library in header `libs`; remove declarations you do not use |
| Fetch/import/CDN scripts | Embed the example data; bundled libraries load from the runtime |
| `width:640px` or a fixed canvas size | Use `viewBox` and 100% SVG dimensions; resize canvas with the stage |
| Missing declaration poster | Set `poster="../visuals/name.svg"`; header posters alone do not provide rail thumbnails |
| Extra Play/Next controls | Keep the runtime's chrome; add only the concept's parameter slider |
| Several concepts crowd one figure | Split the teaching section's goals; choose the most useful single visual |

## Freedom last

If none of the templates expresses the concept, read `references/runtime.md` and
only the needed library guide (`p5.md`, `d3.md`, `three.md`). Adapt the smallest
working template; preserve mounting, fallback colours, sizing, playback and posters.
Do not recreate widget controls in HTML. The book uses shared widget SVG layouts
or authored sketch posters; it never executes HTML. At most six scene stills print.
The optional visual router supplies a hint; this skill still chooses the form.
Scroll-synced stories remain deferred because they conflict with phone scrolling.

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
Embed a source raster only when explicitly CC BY, CC BY-SA, CC0 or public domain;
use `save_asset` with its URL and sourceId to make a set-assets copy for the reader
and book, retain its credit sidecar, and show author/title + license + source
citation in the caption. Unknown, NC, ND or other restrictive licenses require an
original SVG/widget redraw citing the source. A redraw explains the evidence;
never trace/copy a protected photograph or illustration and call it original.
When tools are unavailable, return the complete redraw/credit or explain why a
permitted local copy cannot be saved; never claim a missing asset exists.

Use the brief's chosen video near its supporting concept, with its observed
transcript moment. Watch-only videos count as a quality video but get only a Watch
link and an honest no-transcript line, never claim evidence or invented times.
