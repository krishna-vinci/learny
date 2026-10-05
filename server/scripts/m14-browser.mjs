import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.argv[2];
if (!root?.startsWith("/tmp/studium-m14-")) throw Error("Pass an M14 temp tree");
const dir = await fs.mkdtemp("/tmp/studium-m14-browser-");
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
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const results = [];
  for (const width of [390, 1440])
    for (const set of ["polymers", "hyderabad-history"])
      for (const route of ["", "/plan"]) {
        // Isolate each page's PWA/session and close its event stream before the next capture.
        const browserContextId = (await send("Target.createBrowserContext", { disposeOnDetach: true }))
          .browserContextId;
        const target = (await send("Target.createTarget", { url: "about:blank", browserContextId })).targetId;
        const session = (await send("Target.attachToTarget", { targetId: target, flatten: true })).sessionId;
        const cdp = (method, params = {}) => send(method, params, session);
        await cdp("Page.enable");
        await cdp("Runtime.enable");
        const evaluate = async (expression) =>
          (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result.value;
        await cdp("Emulation.setDeviceMetricsOverride", {
          width,
          height: 1000,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/s/${set}${route}` });
        let ready = false;
        for (let i = 0; i < 200; i++) {
          if (await evaluate("document.body.innerText.includes('Visuals:')")) {
            ready = true;
            break;
          }
          await delay(100);
        }
        if (!ready) {
          const diagnostic = await evaluate("({url:location.href,text:document.body.innerText})");
          const probe = (
            await cdp("Runtime.evaluate", {
              expression: `fetch('/api/sets/${set}/course').then(async r=>({status:r.status,body:(await r.text()).slice(0,300)}))`,
              awaitPromise: true,
              returnByValue: true,
            })
          ).result.value;
          await fs.writeFile(`${dir}/failure.json`, JSON.stringify({ diagnostic, errors, probe }, null, 2));
          console.log(JSON.stringify({ artifact: dir, diagnostic, errors, probe }));
          throw Error(`Media status missing at ${set}${route}`);
        }
        await delay(1000);
        const rowExpression = `(()=>{const section=document.querySelector(${JSON.stringify(route ? '[aria-labelledby="plan-chapters-title"]' : '[aria-labelledby="course-plan-title"]')});const li=section?.querySelector('ol > li');if(!li)return null;const r=li.getBoundingClientRect();return {x:r.x,y:r.y,scrollY:window.scrollY,width:r.width,height:r.height,text:li.innerText};})()`;
        const readRow = async () => {
          for (let i = 0; i < 200; i++) {
            const current = await evaluate(rowExpression).catch((error) => {
              if (/context|navigation/i.test(error.message)) return null;
              throw error;
            });
            if (current?.text.includes("Visuals:")) return current;
            await delay(100);
          }
          throw Error("Course row missing after navigation");
        };
        let row = await readRow();
        // The PWA's first controllerchange can reload after scrolling; repeat actual input on the new page.
        for (let attempt = 0; attempt < 3 && row.y > 60; attempt++) {
          await cdp("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: row.x + row.width / 2,
            y: 500,
            deltaX: 0,
            deltaY: row.y - 60,
          });
          await delay(500);
          row = await readRow();
        }
        const overflow = await evaluate("document.documentElement.scrollWidth>innerWidth");
        if (overflow) throw Error("Horizontal overflow");
        const shot = await cdp("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: {
            x: Math.max(0, row.x),
            y: Math.max(0, row.y + row.scrollY),
            width: row.width,
            height: row.height,
            scale: 1,
          },
        });
        const name = `${width}-${set}${route ? "-plan" : "-course"}.png`;
        await fs.writeFile(`${dir}/${name}`, Buffer.from(shot.data, "base64"));
        results.push({ width, set, page: route ? "Plan" : "Course", overflow, row: row.text, screenshot: name });
        await send("Target.disposeBrowserContext", { browserContextId });
      }
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
