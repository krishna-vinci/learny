import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.argv[2];
const trial = JSON.parse(await fs.readFile(path.join(path.dirname(root), "results.json"), "utf8"));

if (!root?.startsWith("/tmp/studium-m15-")) throw Error("Pass an M15 temp tree");
const dir = await fs.mkdtemp("/tmp/studium-m15-browser-");
const dist = path.resolve(import.meta.dirname, "../../web/dist");
// The local read-only API process uses the real course builder. Only session identity is a browser fixture.
const api = spawn(process.execPath, ["--import", "tsx", "scripts/m15-browser-api.ts", root], {
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
  for (const item of trial.cases) {
    const note = item.draft?.result?.notePath;
    if (!note) continue;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
    await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/s/${item.set}/n/${note.split("/").at(-1)}` });
    let image;
    for (let i = 0; i < 200; i++) {
      image = await evaluate(
        `(()=>{const img=[...document.querySelectorAll('img')].find(e=>/asset\\?/.test(e.src)&&/\\.(?:jpg|png|webp|gif)(?:$|%|&)/i.test(e.src));if(!img||!img.complete||!img.naturalWidth)return null;const r=img.getBoundingClientRect();return {y:r.y,height:r.height,width:r.width,src:img.getAttribute('src'),alt:img.alt,credit:[img.parentElement.innerText,img.closest('p')?.nextElementSibling?.innerText,img.closest('p')?.nextElementSibling?.nextElementSibling?.innerText].filter(Boolean).join('\\n')};})()`,
      );
      if (image) break;
      await delay(100);
    }
    if (!image) throw Error(`${item.set}: real chapter image not loaded`);
    for (let i = 0; i < 40 && (image.y < 150 || image.y + image.height > 750); i++) {
      await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 190, y: 500, deltaX: 0, deltaY: image.y - 180 });
      await delay(150);
      image = await evaluate(
        `(()=>{const img=[...document.querySelectorAll('img')].find(e=>e.getAttribute('src')===${JSON.stringify(image.src)});const r=img.getBoundingClientRect();return {y:r.y,height:r.height,width:r.width,src:img.getAttribute('src'),alt:img.alt,credit:[img.parentElement.innerText,img.closest('p')?.nextElementSibling?.innerText,img.closest('p')?.nextElementSibling?.nextElementSibling?.innerText].filter(Boolean).join('\\n')};})()`,
      );
    }
    if (!image.credit.includes("Credit:")) throw Error(`${item.set}: printed credit missing`);
    if (await evaluate("document.documentElement.scrollWidth>innerWidth")) throw Error("Horizontal overflow");
    const screenshot = `390-${item.set}-image.png`;
    await fs.writeFile(
      `${dir}/${screenshot}`,
      Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
    );
    results.push({ set: item.set, note, image, screenshot });
  }
  await fs.writeFile(`${dir}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ dir, results, errors }));
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  api.kill("SIGTERM");
  for (const response of events) response.end();
  await new Promise((r) => server.close(r));
  server.closeAllConnections();
}
