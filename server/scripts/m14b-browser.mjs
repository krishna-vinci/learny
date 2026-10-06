import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.argv[2];
const note = process.argv[3] ?? "03-carbon-structures-and-reactive-groups.md";
if (!/^[a-z0-9-]+\.md$/.test(note)) throw Error("Pass a chapter filename");
if (!root?.startsWith("/tmp/studium-m14b-")) throw Error("Pass an M14 temp tree");
const dir = await fs.mkdtemp("/tmp/studium-m14b-browser-");
const dist = path.resolve(import.meta.dirname, "../../web/dist");
// The local read-only API process uses the real course builder. Only session identity is a browser fixture.
const api = spawn(process.execPath, ["--import", "tsx", "scripts/m14-browser-api.ts", root], {
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
      if (url.pathname.endsWith("/course") && !response.ok)
        console.log(
          JSON.stringify({ path: url.pathname, status: response.status, body: body.toString().slice(0, 300) }),
        );
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
    if (url.pathname.startsWith("/visual-runtime/")) res.setHeader("Access-Control-Allow-Origin", "*");
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
  const pending = new Map(),
    errors = [];
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
  const results = [];
  const browserContextId = (await send("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
  const target = (await send("Target.createTarget", { url: "about:blank", browserContextId })).targetId;
  const session = (await send("Target.attachToTarget", { targetId: target, flatten: true })).sessionId;
  const cdp = (method, params = {}) => send(method, params, session);
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  const evaluate = async (expression) =>
    (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await cdp("Page.navigate", {
    url: `http://127.0.0.1:${port}/s/polymers/n/${note}`,
  });
  const find = (label) =>
    evaluate(
      `(()=>{const el=[...document.querySelectorAll('button,[role="tab"]')].find(e=>(e.textContent||'').trim().startsWith(${JSON.stringify(label)}));if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
  const waitFind = async (label) => {
    for (let i = 0; i < 100; i++) {
      const point = await find(label).catch(() => null);
      if (point) return point;
      await delay(100);
    }
    throw Error(`Control missing: ${label}`);
  };
  const click = async (point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw Error("Control coordinates unavailable");
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  let tab;
  for (let i = 0; i < 200; i++) {
    tab = await find("Visuals").catch(() => null);
    if (tab) break;
    await delay(100);
  }
  if (!tab) {
    console.log(
      JSON.stringify({
        dir,
        errors,
        text: await evaluate("document.body.innerText"),
        url: await evaluate("location.href"),
      }),
    );
    throw Error("Visuals tab missing");
  }
  await delay(1500);
  tab = await waitFind("Visuals");
  await click(tab);
  for (let i = 0; i < 100; i++) {
    if (await evaluate("document.querySelector('[role=\"tabpanel\"]')?.innerText.includes('visual')")) break;
    await delay(100);
  }
  await delay(1500);
  await fs.writeFile(
    `${dir}/390-visuals-tab.png`,
    Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
  );
  // Bring the stage controls above the phone's fixed bottom navigation.
  await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 200, y: 500, deltaX: 0, deltaY: 280 });
  await delay(500);
  const pause = await find("Pause");
  if (pause) await click(pause);
  const overflow = await evaluate("document.documentElement.scrollWidth>innerWidth");
  if (overflow) throw Error("Horizontal overflow");
  await fs.writeFile(
    `${dir}/390-visuals.png`,
    Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
  );
  results.push({
    width: 390,
    overflow,
    text: await evaluate("document.body.innerText"),
    screenshot: "390-visuals.png",
  });
  // Interact with the active widget using actual browser input, then capture its changed state.
  const buttons = await evaluate(
    "[...document.querySelectorAll('button')].map(e=>({label:e.getAttribute('aria-label')||e.innerText,x:e.getBoundingClientRect().x+e.getBoundingClientRect().width/2,y:e.getBoundingClientRect().y+e.getBoundingClientRect().height/2}))",
  );
  await fs.writeFile(`${dir}/buttons.json`, JSON.stringify(buttons, null, 2));
  const next = buttons.find((b) => /^(next|next step|next scene)$/i.test(b.label.trim()));
  if (!next) throw Error("Step-through Next control missing");
  if (next) {
    const beforeStep = await evaluate("document.body.innerText");
    await click({ x: next.x, y: next.y });
    await delay(500);
    const afterStep = await evaluate("document.body.innerText");
    if (beforeStep === afterStep) throw Error("Next scene did not change the widget");
    results.push({ interaction: "Next scene", before: beforeStep, after: afterStep });
    await fs.writeFile(
      `${dir}/390-visuals-stepped.png`,
      Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
    );
  }
  const second = await waitFind("Compare functional groups");
  if (!second) throw Error("Second interactive visual missing from rail");
  if (second.y > 900) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 200, y: 500, deltaX: 0, deltaY: second.y - 700 });
    await delay(500);
  }
  await click(await waitFind("Compare functional groups"));
  await delay(1500);
  await fs.writeFile(
    `${dir}/390-visuals-groups.png`,
    Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
  );
  const frameTree = (await cdp("Page.getFrameTree")).frameTree;
  const frame = frameTree.childFrames?.find((f) => f.frame.url === "about:srcdoc");
  const targets = (await send("Target.getTargets")).targetInfos;
  const sketchTarget = targets.find((t) => t.type === "iframe");
  let inFrame;
  if (sketchTarget) {
    const frameSession = (await send("Target.attachToTarget", { targetId: sketchTarget.targetId, flatten: true }))
      .sessionId;
    await send("Runtime.enable", {}, frameSession);
    inFrame = async (expression) =>
      (await send("Runtime.evaluate", { expression, returnByValue: true }, frameSession)).result.value;
  } else if (frame) {
    const world = await cdp("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: "m14b-qa" });
    inFrame = async (expression) =>
      (await cdp("Runtime.evaluate", { contextId: world.executionContextId, expression, returnByValue: true })).result
        .value;
  } else {
    console.log(JSON.stringify({ dir, frameTree, targets, text: await evaluate("document.body.innerText") }));
    throw Error("Sketch frame did not load");
  }
  const before = await inFrame(
    "({text:document.body.innerText,value:document.querySelector('input[type=range]')?.value})",
  );
  const slider = await inFrame(
    "(()=>{const e=document.querySelector('input[type=range]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width*.8,y:r.y+r.height/2};})()",
  );
  if (!slider) {
    console.log(
      JSON.stringify({
        dir,
        before,
        frameTree,
        targets,
        child: await inFrame("({url:location.href,studium:typeof studium,text:document.body.innerText})"),
      }),
    );
    throw Error("Functional group selector missing");
  }
  let box = await evaluate(
    "(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y,height:r.height};})()",
  );
  if (box.y + slider.y > 900) {
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 200,
      y: 500,
      deltaX: 0,
      deltaY: box.y + slider.y - 800,
    });
    await delay(500);
    box = await evaluate(
      "(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x,y:r.y,height:r.height};})()",
    );
  }
  await click({ x: box.x + slider.x, y: box.y + slider.y });
  await delay(500);
  const after = await inFrame(
    "({text:document.body.innerText,value:document.querySelector('input[type=range]')?.value})",
  );
  if (before.value === after.value) throw Error("Functional group selection did not change");
  results.push({
    interaction: "functional group slider",
    before,
    after,
    sandbox: await evaluate("document.querySelector('iframe').getAttribute('sandbox')"),
  });
  await fs.writeFile(
    `${dir}/390-visuals-groups.png`,
    Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
  );
  await send("Target.disposeBrowserContext", { browserContextId });
  if (errors.length) throw Error(`Browser errors: ${errors.join(", ")}`);
  await fs.writeFile(`${dir}/results.json`, JSON.stringify({ root, results, errors }, null, 2));
  console.log(JSON.stringify({ artifact: dir, checks: results.length, errors }));
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  api.kill("SIGTERM");
  for (const res of events) res.end();
  await new Promise((r) => server.close(r));
}
