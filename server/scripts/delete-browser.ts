/** Real Chromium input against isolated temporary study trees, with no model/service calls. */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import { EventHub } from "../src/events.js";
import { ensureRepo } from "../src/tree/git.js";
import { FileLocks } from "../src/tree/lock.js";

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "studium-delete-browser-"));
const dist = path.resolve(import.meta.dirname, "../../web/dist");
const app = new Hono();
app.get("/api/auth/status", (c) => c.json({ setupRequired: false, identityProviders: [] }));
app.get("/api/me", (c) =>
  c.json({
    user: { id: 1, username: "tester", displayName: "Deletion trial", role: "ADMIN", aiEnabled: false, avatarUrl: "" },
  }),
);
app.get("/api/jobs", (c) => c.json([]));
app.get("/api/library", (c) => c.json([]));
let root: string;
let workspace: ReturnType<typeof createApp>;
app.all("/api/*", (c) => workspace.fetch(c.req.raw));
app.get("*", async (c) => {
  let file = path.join(dist, c.req.path === "/" ? "index.html" : c.req.path);
  try {
    if (!(await fs.stat(file)).isFile()) throw new Error();
  } catch {
    file = path.join(dist, "index.html");
  }
  const contentType: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  return c.body(await fs.readFile(file), 200, {
    "Content-Type": contentType[path.extname(file)] ?? "application/octet-stream",
  });
});
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
if (!server.address()) await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Local test server failed");
const url = `http://127.0.0.1:${address.port}`;
const chrome = spawn(
  "/usr/bin/google-chrome",
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${scratch}/chrome`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let ws: WebSocket | undefined;
type CdpReply = {
  browserContextId: string;
  targetId: string;
  sessionId: string;
  data: string;
  result: { value: unknown };
  exceptionDetails?: { text: string };
};
const results: unknown[] = [];
const errors: string[] = [];
try {
  let debug: string[] | undefined;
  for (let i = 0; i < 100 && !debug; i++) {
    try {
      debug = (await fs.readFile(`${scratch}/chrome/DevToolsActivePort`, "utf8")).split("\n");
    } catch {
      await delay(100);
    }
  }
  if (!debug) throw new Error("Chrome failed to start");
  ws = new WebSocket(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
  await new Promise<void>((resolve, reject) => {
    if (!ws) return;
    ws.onopen = () => resolve();
    ws.onerror = reject;
  });
  let serial = 0;
  const pending = new Map<number, { resolve: (value: CdpReply) => void; reject: (error: Error) => void }>();
  ws.onmessage = (event) => {
    const data = JSON.parse(String(event.data));
    if (data.id) {
      const request = pending.get(data.id);
      pending.delete(data.id);
      data.error ? request?.reject(new Error(data.error.message)) : request?.resolve(data.result);
    }
    if (data.method === "Runtime.exceptionThrown")
      errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
  };
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpReply> =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      ws?.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    root = `${scratch}/tree-${width}`;
    const put = async (rel: string, text: string) => {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), text);
    };
    const note =
      "---\r\ntitle: Vectors\r\nchapter: vectors\r\norder: 7\r\n---\r\n# Vectors\r\nUnderstand arrows and direction.\r\n![Figure](../assets/vector.svg)\r\n";
    await put(".gitignore", "*/chats/\n**/original.*\n.cache/\n");
    await put(
      "algebra/PLAN.md",
      "---\ntitle: Linear algebra\nstatus: active\nlevel: 2\nsources: []\n---\n\n## Goal\nUnderstand vectors.\n",
    );
    await put("algebra/curriculum.md", "- [x] 01 — Vectors\n  Scope: Direction\n- [ ] 02 — Matrices\n");
    await put("algebra/notes/07-vectors.md", note);
    await put("algebra/notes/01-test.md", "---\ntitle: Manual test\norder: 1\n---\n# Manual test\nDisposable note\n");
    await put(
      "algebra/cards/07-vectors.md",
      "---\nnote: notes/07-vectors.md\ndeck: Algebra::Vectors\n---\n## c-12345678\n<!-- status: exported · type: basic · anki: 123 -->\n**Q:** Direction?\n**A:** Arrow.\n",
    );
    await put(
      "algebra/assets/vector.svg",
      '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"><path d="M10 50H190" stroke="black"/></svg>',
    );
    await put("algebra/media/01-vectors.md", "---\nchapter: Vectors\n---\nbrief\n");
    await put("algebra/chats/private.jsonl", "private\n");
    await put("other/PLAN.md", "---\ntitle: Other set\nstatus: active\n---\n");
    await ensureRepo(root);
    const original = await fs.readFile(`${root}/algebra/notes/07-vectors.md`);
    workspace = createApp({ root, hub: new EventHub(), locks: new FileLocks() });
    const browserContextId = (await send("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
    const targetId = (await send("Target.createTarget", { url: "about:blank", browserContextId })).targetId;
    const session = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    const cdp = (method: string, params: Record<string, unknown> = {}) => send(method, params, session);
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width === 390 });
    const evaluate = async <T = unknown>(expression: string): Promise<T> => {
      const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value as T;
    };
    async function until(expression: string) {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(expression).catch(() => false)) return;
        await delay(100);
      }
      throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText")}`);
    }
    async function goto(route: string, ready: string) {
      await cdp("Page.navigate", { url: `${url}${route}` });
      await until(ready);
      await delay(700);
      await until(ready);
    }
    // DOM reads locate controls; only CDP Input mouse/touch events activate them.
    async function click(selector: string) {
      const expression = `(()=>{const el=${selector};if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`;
      await until(`Boolean(${selector})`);
      await evaluate(expression);
      await delay(250);
      const point = await evaluate<{ x: number; y: number }>(expression);
      if (!point) throw new Error(`Control disappeared before input: ${selector}`);
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
    const button = (text: string) =>
      `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
    const menu = (text: string) =>
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
    const shot = async (name: string) => {
      if (await evaluate("document.documentElement.scrollWidth>innerWidth")) throw new Error(`Overflow: ${name}`);
      await delay(250);
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(`${scratch}/${width}-${name}.png`, Buffer.from(screenshot.data, "base64"));
    };
    await goto("/s/algebra/n/07-vectors.md", "Boolean(document.querySelector('[aria-label=\"More note actions\"]'))");
    await until("Boolean(navigator.serviceWorker.controller)");
    await delay(1500);
    await goto("/s/algebra/n/07-vectors.md", "Boolean(document.querySelector('[aria-label=\"More note actions\"]'))");
    await click("document.querySelector('[aria-label=\"More note actions\"]')");
    await click(menu("Delete note"));
    await until("document.body.innerText.includes('1 exported card stays in Anki')");
    await shot("note-delete-confirm");
    await click(
      `document.querySelector('[role="dialog"]')?.querySelectorAll('button') ? Array.from(document.querySelector('[role="dialog"]').querySelectorAll('button')).find(el=>el.textContent.trim()==='Delete note') : null`,
    );
    await until("location.pathname==='/s/algebra' && document.body.innerText.includes('Undo')");
    await shot("note-deleted");
    await click(button("Undo"));
    await until("location.pathname==='/s/algebra/n/07-vectors.md'");
    if (!(await fs.readFile(`${root}/algebra/notes/07-vectors.md`)).equals(original))
      throw new Error("Undo changed bytes");
    results.push({ width, flow: "reader delete linked chapter and undo", pass: true });

    await goto("/s/algebra", "document.body.innerText.includes('Manual test')");
    await click("document.querySelector('[aria-label=\"Actions for Manual test\"]')");
    await click(menu("Delete note"));
    await until(
      "!Array.from(document.querySelectorAll('a')).some(el=>el.textContent.trim()==='Manual test') && document.body.innerText.includes('Undo')",
    );
    if (await evaluate("Boolean(document.querySelector('[role=\"dialog\"]'))"))
      throw new Error("Unlinked note unexpectedly confirmed");
    await click(button("Undo"));
    await until("Array.from(document.querySelectorAll('a')).some(el=>el.textContent.trim()==='Manual test')");
    results.push({ width, flow: "set-page immediate note delete and undo", pass: true });

    await click(button("Delete study set"));
    await until("Boolean(document.querySelector('#confirm-typed-value'))");
    await shot("set-delete-confirm");
    const dialogConfirm =
      "Array.from(document.querySelector('[role=\"dialog\"]').querySelectorAll('button')).find(el=>el.textContent.trim()==='Delete study set')";
    if (!(await evaluate(`(${dialogConfirm}).disabled`))) throw new Error("Typed confirm was not required");
    await click("document.querySelector('#confirm-typed-value')");
    await cdp("Input.insertText", { text: "Linear algebra" });
    await until(`!(${dialogConfirm}).disabled`);
    await click(dialogConfirm);
    await until("location.pathname==='/sets' && !document.body.innerText.includes('Linear algebra')");
    await click(button("Open"));
    await until(
      "location.pathname==='/settings/recently-deleted' && document.body.innerText.includes('Linear algebra')",
    );
    await shot("recently-deleted");
    await click("document.querySelector('[aria-label=\"Restore Linear algebra\"]')");
    await until("document.body.innerText.includes('Linear algebra restored.')");
    if (!(await fs.readFile(`${root}/algebra/notes/07-vectors.md`)).equals(original))
      throw new Error("Set restore changed bytes");
    const restoredLink = "Array.from(document.querySelectorAll('a')).find(el=>el.textContent.trim()==='Open')";
    await click(restoredLink);
    await until("location.pathname==='/s/algebra' && document.body.innerText.includes('Vectors')");
    await shot("set-restored");
    results.push({ width, flow: "typed set deletion and Recently deleted restore", pass: true });

    await click("document.querySelector('[aria-label=\"Actions for Vectors\"]')");
    await click(menu("Delete note"));
    await until("Boolean(document.querySelector('[role=\"dialog\"]'))");
    await click(
      "Array.from(document.querySelector('[role=\"dialog\"]').querySelectorAll('button')).find(el=>el.textContent.trim()==='Delete note')",
    );
    await until("document.body.innerText.includes('Undo')");
    await goto("/settings/recently-deleted", "Boolean(document.querySelector('[aria-label=\"Restore Vectors\"]'))");
    await click("document.querySelector('[aria-label=\"Restore Vectors\"]')");
    await until("document.body.innerText.includes('Vectors restored.')");
    results.push({ width, flow: "Recently deleted note restore", pass: true });
    await send("Target.disposeBrowserContext", { browserContextId });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(`${scratch}/results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ artifact: scratch, results, errors }));
} catch (error) {
  console.error(JSON.stringify({ artifact: scratch, results, errors, error: String(error) }));
  throw error;
} finally {
  ws?.close();
  chrome.kill("SIGTERM");
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
