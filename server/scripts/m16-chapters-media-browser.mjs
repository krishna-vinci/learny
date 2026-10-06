/**
 * M16 390 px browser trial: numbered set rows, the reader "Chapter 1" eyebrow (both tabs)
 * and the Plan page media counts for chapters 02/03.
 *
 * Usage: node scripts/m16-chapters-media-browser.mjs <temp-tree>
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.argv[2];
if (!root?.startsWith("/tmp/studium-m16-")) throw Error("Pass an M16 temp tree");
const dir = await fs.mkdtemp("/tmp/studium-m16-browser-");
const dist = path.resolve(import.meta.dirname, "../../web/dist");
const api = spawn(process.execPath, ["--import", "tsx", "scripts/m16-browser-api.ts", root], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: ["ignore", "pipe", "inherit"],
});
let apiPort;
api.stdout.on("data", (s) => {
  const m = String(s).match(/BROWSER_API_PORT=(\d+)/);
  if (m) apiPort = Number(m[1]);
});
for (let i = 0; i < 100 && !apiPort; i++) await delay(100);
if (!apiPort) {
  api.kill("SIGTERM");
  throw Error("Local read-only API did not start");
}
const events = new Set();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": connected\n\n");
      events.add(res);
      res.on("close", () => events.delete(res));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const response = await fetch(`http://127.0.0.1:${apiPort}${url.pathname}${url.search}`);
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") ?? "application/json" });
      res.end(body);
      return;
    }
    let file = path.join(dist, url.pathname === "/" ? "index.html" : url.pathname);
    try {
      if (!(await fs.stat(file)).isFile()) throw Error();
    } catch {
      file = path.join(dist, "index.html");
    }
    const ext = path.extname(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      }[ext] || "application/octet-stream",
    );
    res.end(await fs.readFile(file));
  } catch (error) {
    console.error("Browser proxy failed", req.url?.split("?")[0], error instanceof Error ? error.message : "Error");
    res.writeHead(500);
    res.end("Test server error");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const chrome = spawn(
  "/usr/bin/google-chrome",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}/profile`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let ws;
try {
  let debug;
  for (let i = 0; i < 100; i++) {
    try {
      debug = (await fs.readFile(`${dir}/profile/DevToolsActivePort`, "utf8")).split("\n");
      break;
    } catch {
      await delay(100);
    }
  }
  if (!debug) throw Error("Chrome did not start");
  ws = new WebSocket(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let serial = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.id) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.reject(Error(d.error.message)) : p.resolve(d.result);
    }
    if (d.method === "Runtime.exceptionThrown")
      errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject: (e) => reject(Error(`${method}: ${e.message}`)) });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const browserContextId = (await send("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
  const target = (await send("Target.createTarget", { url: "about:blank", browserContextId })).targetId;
  const session = (await send("Target.attachToTarget", { targetId: target, flatten: true })).sessionId;
  const cdp = (method, params = {}) => send(method, params, session);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const evaluate = async (expression) =>
    (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const goto = async (url, ready) => {
    await cdp("Page.navigate", { url: `http://127.0.0.1:${port}${url}` });
    for (let i = 0; i < 200; i++) {
      if (await evaluate(ready)) return;
      await delay(100);
    }
    throw Error(`Not ready: ${url}`);
  };
  const settle = async () => {
    await evaluate("document.fonts?.ready ?? true");
    await evaluate("new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await delay(250);
  };
  const visiblePanelState = () =>
    evaluate(
      `(()=>{const p=document.querySelector('[role="tabpanel"]:not([hidden])');if(!p)return null;const e=p.querySelector('[data-testid="chapter-number"]');const r=e?.getBoundingClientRect();return {eyebrow:e?e.textContent:null,visible:!!e&&r.height>0&&r.width>0,title:(p.querySelector("h1")?.textContent||"").slice(0,80),chars:p.innerText.length};})()`,
    );
  const waitPanel = async (label, expectVisuals, eyebrow = "Chapter 1") => {
    let previous = -1;
    for (let i = 0; i < 200; i++) {
      const state = await visiblePanelState();
      const isVisuals = (await evaluate(`location.search.includes("view=visuals")`)) === true;
      // Both panels lazy-load: wait for fonts, no busy/skeleton marker, and two identical text samples.
      const busy =
        (await evaluate(
          `document.fonts?.status !== "loaded" || !!document.querySelector('[aria-busy="true"], [aria-label="Opening visuals"]')`,
        )) === true;
      if (
        state?.visible &&
        state.eyebrow === eyebrow &&
        state.chars > 60 &&
        isVisuals === expectVisuals &&
        !busy &&
        state.chars === previous
      )
        return state;
      previous = state?.chars ?? -1;
      await delay(100);
    }
    throw Error(`${label}: visible tab panel with ${eyebrow} eyebrow not ready`);
  };
  const clickTab = async (prefix) => {
    const rect = await evaluate(
      `(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(prefix)}));if(!t)return null;const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    if (!rect) throw Error(`Tab not found: ${prefix}`);
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await delay(200);
  };
  const centerOn = async (needle) => {
    await evaluate(
      `(()=>{const el=[...document.querySelectorAll("li")].find(li=>li.innerText.includes(${JSON.stringify(needle)}));el?.scrollIntoView({block:"center"});})()`,
    );
    await delay(300);
  };
  const shot = async (name) => {
    if (await evaluate("document.documentElement.scrollWidth>innerWidth")) throw Error(`${name}: horizontal overflow`);
    await fs.writeFile(
      `${dir}/${name}.png`,
      Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
    );
  };
  const results = {};

  // 1. Set page: numbered note rows (chapter 1 is notes/04-… on disk).
  await goto("/s/polymers", `document.body.innerText.includes("Atoms, molecules")`);
  results.setRows = await evaluate(
    `[...document.querySelectorAll("li")].map(li=>li.innerText.replace(/\\s+/g," ").trim()).filter(t=>t.includes("Atoms, molecules")||t.includes("Bonds and simple")||t.includes("Carbon structures")).slice(0,4)`,
  );
  await centerOn("Atoms, molecules");
  await shot("390-polymers-set-numbered-rows");

  // 2. Reader chapter 1 (notes/04-…). Chapter 1 has no Visuals-tab visual, so the tab list only
  // renders once ?view=visuals is set; from there both tabs are reached with real CDP clicks.
  const readerUrl = "/s/polymers/n/04-atoms-molecules-and-the-chemistry.md";
  await goto(`${readerUrl}?view=visuals`, `location.search.includes("view=visuals")`);
  await settle();
  results.readerVisualsPanel = await waitPanel("visuals tab", true);
  await shot("390-polymers-chapter-1-visuals");
  await clickTab("Reading");
  await settle();
  results.readerReadingPanel = await waitPanel("reading tab", false);
  await shot("390-polymers-chapter-1-reading");

  // 2b. Chapter 2 is the only polymer chapter with a realised Visuals-tab attachment.
  await goto("/s/polymers/n/02-bonds-and-simple-molecular-drawings.md", `location.pathname.includes("02-bonds")`);
  await settle();
  results.chapter2ReadingPanel = await waitPanel("chapter 2 reading", false, "Chapter 2");
  await clickTab("Visuals");
  await settle();
  results.chapter2VisualsPanel = await waitPanel("chapter 2 visuals", true, "Chapter 2");
  await shot("390-polymers-chapter-2-visuals");

  // 3. Plan page rows for chapters 02 and 03 with the new media counts.
  await goto("/s/polymers/plan", `document.body.innerText.includes("Bonds and simple molecular drawings")`);
  const planText = (needle) =>
    `(()=>{const li=[...document.querySelectorAll("li")].find(el=>el.innerText.includes(${JSON.stringify(needle)}));return li?li.innerText.replace(/\\n/g," | "):null;})()`;
  results.planChapter02 = await evaluate(planText("Bonds and simple molecular drawings"));
  results.planChapter03 = await evaluate(planText("Carbon structures and reactive groups"));
  await centerOn("Bonds and simple molecular drawings");
  await shot("390-polymers-plan-chapter-02");
  await centerOn("Carbon structures and reactive groups");
  await shot("390-polymers-plan-chapter-03");

  await fs.writeFile(`${dir}/results.json`, `${JSON.stringify({ results, errors }, null, 2)}\n`);
  console.log(JSON.stringify({ dir, ...results, errors }));
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  api.kill("SIGTERM");
  for (const response of events) response.end();
  await new Promise((r) => server.close(r));
  server.closeAllConnections();
}
