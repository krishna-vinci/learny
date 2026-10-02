# JSON fill slots

JSON has no comments. These are the only `/* FILL: … */` slots for the complete
JSON templates; replace values in place, keeping their types and field names.

| Template | Fill fields | Keep these constraints |
| --- | --- | --- |
| function-plot.json | `title`, `caption`, `x`, `y`, `xLabel`, `yLabel`, `curves[].expression`, `curves[].label`, `params[]` | Increasing ranges; parameter default within min/max; expressions use only x and declared parameters; short axis/curve labels |
| matrix-transform.json | `title`, `caption`, `matrix`, `svd.vT`, `svd.sigma`, `svd.u` | Square 2×2 or 3×3; UΣVᵀ must equal matrix; Σ diagonal/nonnegative; U and V orthogonal; delete all of `svd` when it is not an SVD lesson |
| step-through.json | `title`, `view`, `steps[].caption`, `steps[].items`, `steps[].active`, `steps[].edges` if graph | Views array/boxes/graph; short items, valid zero-based indices; captions explain each changed state |
| timeline.json | `title`, `caption`, `events[].date/title/category/description`, `eras[].start/end/title` | Years or sourced ISO dates; at most four categories; end after start; short titles at endpoints |

The example SVD is exact: [[0,-1],[2,0]] = [[0,-1],[1,0]] × diag(2,1) × I.
Do not invent extra fields for annotations or controls. Use captions/narration.
Copy the matching SVG only when a widget needs an optional declaration poster;
widgets already generate book stills automatically. If copying, update geometry to
match the edited JSON; do not leave an unrelated example poster.
