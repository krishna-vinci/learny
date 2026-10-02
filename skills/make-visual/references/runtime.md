# Sketch runtime API (M9)

No imports/CDNs/network: libraries are public, immutable, local files and loaded only
when declared. Globals: `p5` (2.3.4), `d3` (7.9.0), `THREE` (0.186.1).
The frame is opaque (`sandbox="allow-scripts"`), has no cookies and cannot fetch.

Header (application/json, exact id; only libs/story/aspect/poster/posters allowed):

```html
<script type="application/json" id="studium-visual">
{"libs":["d3"],"story":true,"aspect":"16:10","posters":[{"src":"start.svg","narration":"Begin at equilibrium."},{"src":"end.svg","narration":"The parameter changes the outcome."}]}
</script>
```

Non-story sketches use `"poster":"name.svg"`. Poster paths are relative to the
HTML file, within visuals/, without traversal. Aspect is a design hint; the Reader
uses phone viewport height and reserves bottom room for controls.

`studium`:
- `mount({scenes?,draw})`: runtime owns animation time. Scenes are ordered
  `{state,narration}`; draw receives `{state,scene,time,playing,theme}`. Time is active
  milliseconds within the scene; scenes advance after four seconds, stop on the last.
- `theme`: `{bg,fg,muted,accent,grid,font,palette,dark}` from the parent, updated live.
- `palette`: eight contrast-mapped Okabe-Ito hue colours; use it for geometry.
- `playing`, `scene`, `reducedMotion`: current playback values.
- `go(index)`: clamp/set the scene; built-in Previous/Next/dots/scrub already do this.
- `onTheme(fn)`: subscribe, returns unsubscribe (prefer drawing from the passed theme).
- `slider({label,min,max,value,step?,onChange})`: labelled range in the controls area.
- `exportPoster()`: serializes an SVG in the stage; returns null for canvas. Author
  and save static SVG stills with study tools; there is no privileged download bridge.

Mount your SVG/canvas in `#studium-stage` at DOMContentLoaded. The runtime has already
created it and `#studium-chrome`. Do not remove the chrome. It supplies Previous/Next, scene scrub/dots/narration and arrow/space keyboard
support. Play/Pause lives in the app control strip; do not add another button. Use the
stage's client width/height and ResizeObserver for resizing. Font is the app's system
stack; no webfonts. Controls use 44 px targets. Respect `playing`/reduced motion.

```html
<script>
const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
svg.setAttribute('viewBox','0 0 640 400');
svg.style.width='100%'; svg.style.height='100%';
document.addEventListener('DOMContentLoaded',()=>document.getElementById('studium-stage').append(svg));
studium.mount({
  scenes:[{state:{length:1},narration:'Begin with one unit.'},{state:{length:2},narration:'The stretched vector is twice as long.'}],
  draw:({state,theme})=>{
    svg.replaceChildren();
    const line=document.createElementNS(svg.namespaceURI,'line');
    for(const [key,value] of Object.entries({x1:100,y1:200,x2:100+140*(state.length||1),y2:200,stroke:studium.palette[0],'stroke-width':6})) line.setAttribute(key,value);
    svg.append(line);
  }
});
</script>
```

No private animation loops/timers. Draw p5 with noLoop/redraw, D3 with synchronous
DOM updates, Three with renderer.render in the runtime draw callback. Dispose any
Three GPU resources on teardown. Pages pause when hidden/offscreen; phone arbitration
permits one sketch. Parent accepts only validated ready/error/scene events from this
frame; don't add messaging protocols. Scrollytelling and headless book capture deferred.
