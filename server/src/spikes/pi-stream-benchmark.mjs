import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const entry = new URL(import.meta.resolve("@earendil-works/pi-ai")).pathname;
const modulePath = process.argv[2] ?? new URL("./utils/json-parse.js", pathToFileURL(entry)).pathname;
const { parseStreamingJson } = await import(pathToFileURL(modulePath).href);
const text = JSON.stringify({ content: "x".repeat(280_000 - 14) });
const start = performance.now();
let parsed;
let calls = 0;
for (let end = 20; end < text.length; end += 20) {
  parsed = parseStreamingJson(text.slice(0, end));
  calls++;
}
parsed = parseStreamingJson(text);
calls++;
assert.equal(parsed.content, JSON.parse(text).content);
const ms = performance.now() - start;
console.log(JSON.stringify({ bytes: Buffer.byteLength(text), chunkChars: 20, calls, ms, finalExact: true }));
if (ms >= 1000) process.exitCode = 1;
