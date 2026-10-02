# Widget catalog (M9)

Every JSON has `type`, `title`, optional `caption`, optional
`story: {scenes:[{state:{...},narration:"One sentence."}]}`. Unknown fields are rejected.
Story state uses the numeric control names below. Author up to 100 scenes; the book
prints all up to six, then first/last. Each JSON ≤300 KB.

## function-plot

`x`/`y`: increasing numeric domain pairs. `xLabel`/`yLabel`: labels with units.
`curves`: 1–8 `{expression,label}` entries. `params`: up to 12 unique
`{name,min,max,value,step?}` entries (names start with a letter, letters/digits only,
not x/function/prototype names); `points`: up to 20 `{x,y,label}` entries.
State: parameter names → numeric values. Curves sample 241 points and break at singularities.
Expressions: numbers, declared variables, + - * / % ^, parentheses and sin/cos/exp/log/
sqrt/abs/pow/min/max/floor/ceil. No member access, assignment, strings or definitions.

```json
{"type":"function-plot","title":"A spring's restoring force","caption":"The force points back toward equilibrium.","x":[-2,2],"y":[-8,8],"xLabel":"Displacement (m)","yLabel":"Force (N)","params":[{"name":"k","min":1,"max":4,"value":2,"step":0.1}],"curves":[{"expression":"-k*x","label":"F = −kx"}],"points":[{"x":0,"y":0,"label":"Equilibrium"}],"story":{"scenes":[{"state":{"k":1},"narration":"A soft spring gives a shallow force curve."},{"state":{"k":4},"narration":"A stiff spring gives a larger force at the same displacement."}]}}
```

## matrix-transform

`matrix`: square 2×2 or 3×3 numeric matrix; entries −100…100. A 3×3 is shown
by applying it to z=0 and projecting onto x/y. Default state is the complete transform.
State: `progress` (0…1) interpolates identity → target, `stage` (0/1/2) selects SVD.
Optional `svd:{vT,sigma,u}`: same-size matrices, authored decomposition; scenes show
Vᵀ, ΣVᵀ, UΣVᵀ cumulatively. Use a correct SVD, not an arbitrary factorization.

```json
{"type":"matrix-transform","title":"Stretch and rotate","matrix":[[0,-1],[2,0]],"svd":{"vT":[[1,0],[0,1]],"sigma":[[2,0],[0,1]],"u":[[0,-1],[1,0]]}}
```

Grid, unit circle and labelled basis vectors transform together. SVD supplies three
narrated scenes automatically; an explicit story overrides them.

## step-through

`view`: array (default), graph, boxes. `steps`: 1–100
`{caption,items,active?,edges?}`. Items are strings/numbers (array ≤24, graph ≤8, boxes ≤6); active indices and edge
pairs must reference existing items. Use short labels; put the explanation in captions.
State: `step` (zero-based). Steps automatically supply narrated scenes.

```json
{"type":"step-through","title":"Compare then swap","view":"array","steps":[{"caption":"Compare the two adjacent values.","items":[3,1,2],"active":[0,1]},{"caption":"Swap them because the left value is larger.","items":[1,3,2],"active":[0,1]},{"caption":"Compare the next pair to continue the pass.","items":[1,3,2],"active":[1,2]}]}
```

For a small graph, use `view:"graph"`, node names as items and `edges:[[0,1]]`.
For a pipeline or polymerisation stages, use `view:"boxes"` and short process labels.

## timeline

`events`: 1–200 `{date,title,category,description?}`; date is a numeric year
(negative = BCE) or an ISO `YYYY-MM-DD` date. `eras`: up to 30 `{start,end,title}`
with increasing dates. Categories determine lanes and colour. Use short event titles.
State: `zoom` (1…10), `center` (year), `selected` (zero-based event).
Zoom and event selection are controls; a story can focus on individual events.

```json
{"type":"timeline","title":"Hyderabad's changing centres","events":[{"date":1591,"title":"Hyderabad founded","category":"City","description":"Muhammad Quli Qutb Shah established the city."},{"date":1724,"title":"Asaf Jahi rule","category":"Rule","description":"1724 marks the start of the Asaf Jahi dynasty."},{"date":1948,"title":"Integration","category":"Rule","description":"Hyderabad became part of India."}],"eras":[{"start":1724,"end":1948,"title":"Asaf Jahi era"}],"story":{"scenes":[{"state":{"selected":0},"narration":"Begin with the city's founding."},{"state":{"selected":2},"narration":"Integration changed its political setting."}]}}
```

Use actual ISO dates only when the source gives a day; use years for approximate history.
