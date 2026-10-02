---
name: make-visual
description: Teach a single concept with a built-in widget or a local sketch and static book stills.
---

# Make a visual

A visual earns its place when changing a parameter, inspecting geometry or stepping
through a process makes the idea easier to understand. One concept per visual.
The chapter's prose must stand alone. Do not add motion as decoration.

## Choose the form

| Need | Form |
| --- | --- |
| Vary an equation, transform a matrix, inspect a trace or explore dates | Built-in widget first |
| A custom interactive model beyond the catalog | Sketch on Studium's bundled runtime |
| Static explanatory data/comparison | Inline Vega-Lite (`media-authoring`) |
| Flow, dependency or sequence | Inline Mermaid (`media-authoring`) |
| Static geometry, diagram or labelled structure | SVG figure (`media-authoring`) |
| Source image or video moment | `media-authoring` |

Read `references/widgets.md` for the four complete schemas/examples. Use a widget
unless it cannot express the concept; don't recreate its axes or controls in HTML.
Read `references/runtime.md` before writing a sketch, and only the needed version-pinned
cheat-sheet: `p5.md`, `d3.md` or `three.md`. Context7 can clarify those library APIs.

## Write and attach

1. Read the chapter, PLAN subject and relevant sources. State the concept to teach.
2. Write `<set>/visuals/<name>.json` for a widget or `.html` for a sketch using the
   normal study tools. Validation errors contain zod details; fix them before continuing.
3. Sketches require a static SVG poster, or one SVG/narration per story scene, declared
   in their `studium-visual` JSON header. Keep these files in the same visuals folder.
4. Append a standalone leaf after chapter prose/footnotes, in exploration order:

```md
::visual{src="../visuals/stretch.json" title="How a matrix stretches space"}
::visual{src="../visuals/process.html" title="Follow the process"}
```

No registry heading/frontmatter is needed. Paths are note-relative, confined to the
same set's `visuals/` folder. Do not nest declarations in lists, quotes or callouts.
Preserve existing `::artifact` attachments and their files; that legacy alias keeps
its click-to-run behavior. Write all new interactive visuals into `visuals/`.
The Reader collects both forms in **Visuals**, never inline in Reading.

## Quality bar

- One concept, one purposeful interaction; one narration sentence per scene.
- Label axes and values, including units. Name parameters and give sensible defaults/ranges.
- Readable at 360 px: avoid crowded text and rely on labels/shapes as well as colour.
- Use `studium.palette` and `studium.theme` in sketches; widgets inherit these tokens.
  The palette uses Okabe-Ito hues mapped for contrast in all five app themes.
- Touch targets ≥44 px, keyboard arrows/space, meaningful scrub/step controls.
- Let the runtime own time. Draw only inside `studium.mount({draw})`; no private
  requestAnimationFrame, timers, p5 loop or Three animation loop. p5 uses `noLoop()`.
- Visible visuals autoplay; hidden/offscreen visuals pause. Reduced motion starts on
  scene one paused, with manual navigation. Leaving Visuals stops/unmounts the frame.
- No network, CDN imports, external fonts or images. Declare only needed bundled libs.
- Each authored JSON/HTML/SVG ≤300 KB (public libraries are separate). No scripts,
  foreignObject, event handlers or external resources in SVG posters.

## Book contract

Widgets use the same pure layout for default-state SVG and every story scene.
Sketches use authored posters; the compiler never executes HTML or opens a browser.
At most six scene stills: longer stories print first/last and “N more scenes in Studium”.
Include captions that convey the concept without motion. Missing sketch posters in
old/user-edited files degrade to a title and chapter Visuals pointer.
Automatic headless captures and Mermaid-to-SVG remain deferred.

## Router slot

`VisualRouter.decide({heading,text,subject})` is reserved in the server.
`visuals.router: off` is the default configuration; `nullRouter` returns null, so
this skill's judgment applies. No router/model call or paid setup is required.
Scroll-synced stories are deferred: phone scroll conflicts with the Visuals list.
