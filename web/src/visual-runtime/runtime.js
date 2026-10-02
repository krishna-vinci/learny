import { parseVisualControl } from "./control-message";

(() => {
  const send = (event, extra = {}) => parent.postMessage({ type: "studium-visual", event, ...extra }, "*");
  const style = document.createElement("style");
  style.textContent = `:root{--bg:#fafaf9;--fg:#292524;--muted:#57534e;--accent:#0072B2;--grid:#d6d3d1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}#studium-stage{flex:1;min-height:0;overflow:hidden}#studium-stage canvas,#studium-stage svg{max-width:100%;max-height:100%}#studium-chrome{padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--bg)}#studium-chrome .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#studium-chrome button{min-width:44px;min-height:44px;border:1px solid var(--grid);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit;padding:8px}#studium-chrome input{min-height:44px;flex:1;min-width:80px;accent-color:var(--accent)}#studium-chrome p{margin:0;line-height:1.5}#studium-chrome button[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}body{height:100svh;display:flex;flex-direction:column}`;
  document.head.append(style);
  let enabled = false,
    playing = true,
    reduced = false,
    scene = 0,
    elapsed = 0,
    last = 0,
    raf = 0,
    scenes = [],
    draw = () => {};
  const listeners = new Set();
  const palette = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"];
  const runtime = {
    palette,
    // Complete from the first draw: sketches render once before the parent's theme message arrives,
    // and the documented shape includes `palette` (a sketch reading theme.palette[0] crashed on {}).
    theme: {
      bg: "#fafaf9",
      fg: "#292524",
      muted: "#57534e",
      accent: "#0072B2",
      grid: "#d6d3d1",
      font: "system-ui, sans-serif",
      palette,
      dark: false,
    },
    get playing() {
      return enabled && playing && !reduced;
    },
    get scene() {
      return scene;
    },
    get reducedMotion() {
      return reduced;
    },
    onTheme(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    mount(options) {
      scenes = options.scenes ?? [];
      draw = options.draw ?? (() => {});
      if (scenes.length > 100) throw new Error("At most 100 scenes");
      if (document.body) {
        setup();
        render();
      }
    },
    go(index) {
      scene = Math.max(0, Math.min(scenes.length - 1, index));
      elapsed = 0;
      render();
    },
    exportPoster() {
      const svg = document.querySelector("#studium-stage svg");
      return svg ? new XMLSerializer().serializeToString(svg) : null;
    },
    slider({ label, min, max, value, step = 0.01, onChange }) {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      Object.assign(input, { min, max, value, step });
      input.setAttribute("aria-label", label);
      input.addEventListener("input", () => onChange(Number(input.value)));
      wrap.append(input);
      document.getElementById("studium-chrome").append(wrap);
      return input;
    },
  };
  window.studium = runtime;
  let chrome, caption, scrub, dots;
  function setup() {
    if (!document.getElementById("studium-stage")) {
      const stage = document.createElement("div");
      stage.id = "studium-stage";
      document.body.prepend(stage);
    }
    chrome = document.getElementById("studium-chrome");
    if (chrome) chrome.remove();
    chrome = document.createElement("div");
    chrome.id = "studium-chrome";
    const row = document.createElement("div");
    row.className = "row";
    const button = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.type = "button";
      b.addEventListener("click", fn);
      row.append(b);
      return b;
    };
    // Scene controls only for stories; play/pause lives in the app's control strip.
    if (scenes.length > 1) {
      button("Previous", () => {
        playing = false;
        runtime.go(scene - 1);
      });
      button("Next", () => {
        playing = false;
        runtime.go(scene + 1);
      });
      scrub = document.createElement("input");
      scrub.type = "range";
      scrub.min = "0";
      scrub.max = String(Math.max(0, scenes.length - 1));
      scrub.step = "1";
      scrub.setAttribute("aria-label", "Scene");
      scrub.addEventListener("input", () => {
        playing = false;
        runtime.go(Number(scrub.value));
      });
      row.append(scrub);
      chrome.append(row);
      dots = document.createElement("div");
      dots.className = "row";
      scenes.forEach((_, i) => {
        const b = document.createElement("button");
        b.textContent = String(i + 1);
        b.setAttribute("aria-label", `Scene ${i + 1}`);
        b.onclick = () => {
          playing = false;
          runtime.go(i);
        };
        dots.append(b);
      });
      chrome.append(dots);
    }
    caption = document.createElement("p");
    caption.setAttribute("aria-live", "polite");
    chrome.append(caption);
    document.body.append(chrome);
    schedule();
  }
  function render() {
    if (caption) {
      caption.textContent = scenes[scene]?.narration ?? "";
      if (scrub) scrub.value = String(scene);
      [...(dots?.children ?? [])].forEach((b, i) => {
        b.setAttribute("aria-pressed", String(i === scene));
      });
    }
    draw({ state: scenes[scene]?.state ?? {}, scene, time: elapsed, playing: runtime.playing, theme: runtime.theme });
    send("scene", { scene });
  }
  function tick(time) {
    raf = 0;
    const delta = last ? Math.min(time - last, 100) : 0;
    last = time;
    if (runtime.playing) {
      elapsed += delta;
      if (scenes.length > 1 && elapsed >= 4000) {
        if (scene === scenes.length - 1) playing = false;
        else {
          scene++;
          elapsed = 0;
        }
        render();
      } else draw({ state: scenes[scene]?.state ?? {}, scene, time: elapsed, playing: true, theme: runtime.theme });
    }
    schedule();
  }
  function schedule() {
    if (!raf && runtime.playing) {
      raf = requestAnimationFrame(tick);
    } else if (!runtime.playing && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }
  }
  window.addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const control = parseVisualControl(e.data);
    if (!control) return;
    if (control.theme) {
      runtime.theme = { ...runtime.theme, ...control.theme };
      if (control.theme.palette?.length) runtime.palette = control.theme.palette;
      else runtime.theme.palette = runtime.palette;
      for (const k of ["bg", "fg", "muted", "accent", "grid"])
        document.documentElement.style.setProperty(`--${k}`, control.theme[k]);
      document.body.style.fontFamily = control.theme.font;
      listeners.forEach((fn) => {
        fn(control.theme);
      });
    }
    if (control.active !== undefined) enabled = control.active;
    if (control.reduced !== undefined && control.reduced !== reduced) {
      reduced = control.reduced;
      if (reduced) {
        playing = false;
        scene = 0;
        elapsed = 0;
      }
    }
    if (control.playing !== undefined && control.playing !== playing) {
      playing = control.playing;
      if (!playing) elapsed = 0;
    }
    render();
    schedule();
  });
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.key === "ArrowLeft") {
      playing = false;
      runtime.go(scene - 1);
    } else if (e.key === "ArrowRight") {
      playing = false;
      runtime.go(scene + 1);
    } else if (e.code === "Space") {
      playing = !playing;
      render();
      schedule();
    } else return;
    e.preventDefault();
  });
  window.addEventListener("error", (e) => send("error", { message: String(e.message).slice(0, 500) }));
  window.addEventListener("unhandledrejection", (e) => send("error", { message: String(e.reason).slice(0, 500) }));
  document.addEventListener("DOMContentLoaded", () => {
    if (!chrome) setup();
    render();
    send("ready");
  });
})();
