/**
 * M17 real-click plan and proposal editing trial at 390px and 1440px.
 *
 * Usage: node scripts/m17-chapters-media-browser.mjs <temp-tree>
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.argv[2];
if (!root?.startsWith("/tmp/studium-m17-")) throw Error("Pass an M16 temp tree");
const dir = await fs.mkdtemp("/tmp/studium-m17-browser-");
console.log(`BROWSER_ARTIFACT_DIR=${dir}`);
const dist = path.resolve(import.meta.dirname, "../../web/dist");
const api = spawn(process.execPath, ["--import", "tsx", "scripts/m17-browser-api.ts", root], {
  cwd: path.resolve(import.meta.dirname, ".."),
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, STUDIUM_FAUX: "1", PI_CODING_AGENT_DIR: `${dir}/pi` },
});
let apiPort;
api.stdout.on("data", (s) => {
  const m = String(s).match(/BROWSER_API_PORT=(\d+)/);
  if (m) apiPort = Number(m[1]);
});
for (let i = 0; i < 600 && !apiPort; i++) await delay(100);
if (!apiPort) {
  api.kill("SIGTERM");
  throw Error("Local trial API did not start");
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
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(`http://127.0.0.1:${apiPort}${url.pathname}${url.search}`, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
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
  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails)
      throw Error(
        `Evaluate ${expression}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    return result.result.value;
  };
  const goto = async (url, ready) => {
    await cdp("Page.navigate", { url: `http://127.0.0.1:${port}${url}` });
    for (let i = 0; i < 200; i++) {
      try {
        if (await evaluate(ready)) return;
      } catch (error) {
        if (!/context|Cannot read properties of null/.test(error.message)) throw error;
      }
      await delay(100);
    }
    throw Error(`Not ready: ${url}`);
  };
  const settle = async () => {
    await evaluate("document.fonts?.ready ?? true");
    await evaluate("new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await delay(250);
  };
  const shot = async (name) => {
    if (await evaluate("document.documentElement.scrollWidth>innerWidth")) throw Error(`${name}: horizontal overflow`);
    await fs.writeFile(
      `${dir}/${name}.png`,
      Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
    );
  };
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        if (!/context|Cannot read properties of null/.test(error.message)) throw error;
      }
      await delay(100);
    }
    await fs.writeFile(
      `${dir}/failure.json`,
      JSON.stringify({ expression, text: await evaluate("document.body?.innerText"), errors }, null, 2),
    );
    await fs.writeFile(
      `${dir}/failure.png`,
      Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"),
    );
    throw Error(`Condition failed: ${expression}`);
  };
  const click = async (expression) => {
    await wait(`!!(${expression})`);
    await evaluate(`(${expression}).scrollIntoView({block:"center"})`);
    await settle();
    const rect = await evaluate(
      `(()=>{const r=(${expression}).getBoundingClientRect();return {x:Math.max(0,r.x)+Math.min(r.width,innerWidth)/2,y:(Math.max(0,r.y)+Math.min(innerHeight,r.bottom))/2};})()`,
    );
    if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y))
      throw Error(`Missing click rect: ${expression}: ${JSON.stringify(rect)}`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
    if (expression === button("Save"))
      console.log(
        "SAVE_CLICK",
        JSON.stringify({
          rect,
          hit: await evaluate(`document.elementFromPoint(${rect.x},${rect.y})?.outerHTML.slice(0,500)`),
        }),
      );
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp("Input.dispatchMouseEvent", { type, ...rect, button: "left", clickCount: 1 });
    await delay(200);
  };
  const byText = (role, label) =>
    `[...document.querySelectorAll(${JSON.stringify(role)})].find(x=>x.textContent.trim()===${JSON.stringify(label)})`;
  const button = (label) => byText("button", label);
  const type = async (selector, value) => {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      windowsVirtualKeyCode: 65,
    });
    await cdp("Input.insertText", { text: value });
  };
  const menu = async (title, action) => {
    await click(`document.querySelector('button[aria-label="Actions for ${title}"]')`);
    await click(byText('[role="menuitem"]', action));
  };
  const apiRead = async (resource) => {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/sets/polymers/${resource}`);
    if (!response.ok) throw Error(`Read failed ${resource}`);
    return response.json();
  };
  const results = {};
  const original = await apiRead("course");
  const chapter1 = original.chapters[0].title;
  const chapter3 = original.chapters[2].title;
  const chapter5 = original.chapters[4].title;
  const renamed = "Carbon structures, groups and reactions";
  await goto("/s/polymers/plan", `document.body?.innerText.includes(${JSON.stringify(chapter3)})`);
  await wait("!!navigator.serviceWorker.controller");
  await delay(1000);
  await goto("/s/polymers/plan", `document.body?.innerText.includes(${JSON.stringify(chapter3)})`);
  await settle();
  await shot("390-plan-page");
  await menu(chapter3, "Edit chapter");
  await wait(`!!document.querySelector('#chapter-edit-title')`);
  await shot("390-chapter-sheet");
  await type("#chapter-edit-title", renamed);
  await click(button("Save chapter"));
  await wait(`!document.querySelector('#chapter-edit-title')`);
  const renamedCourse = await apiRead("course");
  results.renameKeptNote = renamedCourse.chapters[2].path === original.chapters[2].path;
  if (!results.renameKeptNote) throw Error("Rename broke note identity");
  await menu(chapter1, "Edit chapter");
  await click(button("Add visual"));
  const concepts = await evaluate(`[...document.querySelectorAll('[id^="visual-concept-"]')].map(x=>x.id)`);
  await type(`#${concepts.at(-1)}`, "Bond formation; step through one bond at a time");
  await click(button("Save chapter"));
  await wait(`!document.querySelector('#chapter-edit-title')`);
  results.visualAdded = (await apiRead("curriculum")).chapters[0].visuals.includes(
    "step-through — Bond formation; step through one bond at a time",
  );
  if (!results.visualAdded) throw Error("Visual was not saved");
  // The real polymers chapter 05 depends on 04. Verify refusal and keep its prerequisite.
  await menu(chapter5, "Move up");
  await wait(`document.body?.innerText.includes("prerequisites cannot")`);
  results.invalidMoveRefused = (await apiRead("course")).chapters[4].title === chapter5;
  if (!results.invalidMoveRefused) throw Error("Invalid move changed curriculum");
  await click(`document.querySelector('button[aria-label="Dismiss"]')`);
  // Delete a drafted chapter and undo using the UI's commit Undo action.
  await menu(renamed, "Delete chapter");
  await wait(`document.body?.innerText.includes("Its note will be kept")`);
  await click(button("Delete chapter"));
  await wait(`!document.querySelector('button[aria-label="Actions for ${renamed}"]')`);
  results.deletedNoteKept = (await apiRead("course")).otherNotes.some((n) => n.path === original.chapters[2].path);
  await click(button("Undo"));
  await wait(`!!document.querySelector('button[aria-label="Actions for ${renamed}"]')`);
  results.undoRestored = (await apiRead("course")).chapters[2].path === original.chapters[2].path;
  await click(button("Edit plan text"));
  await wait(`!!document.querySelector('.cm-content')`);
  await click(`document.querySelector('.cm-content')`);
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "End",
    code: "End",
    modifiers: 2,
    windowsVirtualKeyCode: 35,
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "End",
    code: "End",
    modifiers: 2,
    windowsVirtualKeyCode: 35,
  });
  await cdp("Input.insertText", { text: "\n\nM17 temporary browser trial plan text.\n" });
  await click(button("Save"));
  await wait(`!document.querySelector('[data-note-editor]')`);
  results.planTextSaved = (await apiRead("file?path=PLAN.md")).raw.includes("M17 temporary browser trial plan text.");
  if (!results.planTextSaved) throw Error("Plan text not saved");
  await goto("/s/polymers", `document.body?.innerText.includes("Course plan")`);
  await menu(renamed, "Edit chapter");
  results.courseMenuEdit = await evaluate(`!!document.querySelector('#chapter-edit-title')`);
  await click(button("Cancel"));
  results.setNotes = await evaluate(
    `[...document.querySelectorAll('a[href*="/n/"]')].map(x=>({text:x.textContent.trim(),href:x.getAttribute('href')})).filter(x=>x.href.includes(${JSON.stringify(original.chapters[2].path.replace("notes/", ""))}))`,
  );
  await goto("/s/polymers/plan", `document.body?.innerText.includes(${JSON.stringify(renamed)})`);
  await click(button("Change with agent"));
  await type("#plan-set-goal", "Add a photo slot to chapter 3");
  await click(button("Propose change"));
  await wait(`!document.querySelector('#plan-set-goal')`);
  let items;
  for (let i = 0; i < 150; i++) {
    items = await apiRead("inbox");
    if (items.some((x) => x.kind === "plan")) break;
    await delay(100);
  }
  const proposalItem = items.find((x) => x.kind === "plan");
  if (!proposalItem) throw Error("Faux proposal did not reach Inbox");
  results.agentProposal = proposalItem.path;
  await goto("/s/polymers/inbox", `document.body?.innerText.includes("To review")`);
  // Click the proposal row using its title; the real inbox selects the item inline.
  await click(
    `[...document.querySelectorAll('li > button')].find(x=>x.textContent.includes(${JSON.stringify(proposalItem.title)}))`,
  );
  await wait(`document.body?.innerText.includes("What changes")`);
  // Edit proposal chapter 3 (both title and scope) without installing it.
  await menu(renamed, "Edit chapter");
  await type("#chapter-edit-title", "Carbon groups, with a photo");
  await type("#chapter-edit-scope", "Recognise carbon structures and functional groups using a real photograph.");
  await click(button("Save chapter"));
  await wait(`!document.querySelector('#chapter-edit-title')`);
  await wait(`document.body?.innerText.includes("Carbon groups, with a photo")`);
  results.proposalEditKeptLive = (await apiRead("course")).chapters[2].title === renamed;
  await click(byText("summary", "View changes"));
  await settle();
  await shot("390-inbox-change-summary");
  for (const [width, height, mobile] of [[1440, 1000, false]]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await settle();
    await shot("1440-inbox-change-summary");
    await goto("/s/polymers/plan", `document.body?.innerText.includes(${JSON.stringify(renamed)})`);
    await settle();
    await shot("1440-plan-page");
    await menu(renamed, "Edit chapter");
    await settle();
    await shot("1440-chapter-dialog");
    await click(button("Cancel"));
  }
  if (!results.deletedNoteKept || !results.undoRestored || !results.proposalEditKeptLive)
    throw Error("Linked-edit trial failed");
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
