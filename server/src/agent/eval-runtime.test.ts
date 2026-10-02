import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { evalRuntime } from "./eval-runtime.js";
import * as models from "./models.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
it("reserves each model request before sending and preserves the budget across restarts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-budget-"));
  roots.push(root);
  const file = path.join(root, "calls.json");
  const message = {
    usage: { input: 7, output: 3, cacheRead: 11, cacheWrite: 0 },
    content: [{ type: "text", text: "ok" }],
    stopReason: "stop",
  };
  const stream = vi.fn(() => ({ result: async () => message }));
  const runtime = { streamSimple: stream, getModel: () => ({ provider: "subscription", id: "test" }) };
  vi.spyOn(models, "createModelRuntime").mockResolvedValue(runtime as never);
  const adapter = await evalRuntime(file, 1);
  expect(await adapter.judge("subscription/test", "judge")).toBe("ok");
  await Promise.resolve();
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  expect(stored).toEqual({ calls: 1, usage: { subscription: { fresh: 7, output: 3, cacheRead: 11, cacheWrite: 0 } } });
  expect(() => adapter.runtime.streamSimple({ provider: "subscription" } as never, {} as never)).toThrow("cap");
  expect(stream).toHaveBeenCalledTimes(1);
  adapter.close();
  const freshStream = vi.fn();
  const freshRuntime = { streamSimple: freshStream, getModel: runtime.getModel };
  vi.mocked(models.createModelRuntime).mockResolvedValue(freshRuntime as never);
  const resumed = await evalRuntime(file, 1);
  await expect(resumed.judge("subscription/test", "again")).rejects.toThrow("cap");
  expect(freshStream).not.toHaveBeenCalled();
});
it("counts provider errors as attempts and keeps judge images in the request", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-error-"));
  roots.push(root);
  const stream = vi.fn((_model, context) => {
    expect(context.messages[0].content[1]).toEqual({ type: "image", mimeType: "image/png", data: "fake-image" });
    return {
      result: async () => ({
        stopReason: "error",
        errorMessage: "unavailable",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    };
  });
  vi.spyOn(models, "createModelRuntime").mockResolvedValue({
    streamSimple: stream,
    getModel: () => ({ provider: "p", id: "m" }),
  } as never);
  const adapter = await evalRuntime(path.join(root, "calls.json"));
  adapter.beginTurn(1);
  await expect(adapter.judge("p/m", "rubric", "fake-image")).rejects.toThrow("unavailable");
  await expect(adapter.judge("p/m", "rubric", "fake-image")).rejects.toThrow("cap");
  expect(adapter.state.calls).toBe(1);
});

it("rejects simultaneous ownership and corrupted ledgers without sending a request", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-lock-"));
  roots.push(root);
  const file = path.join(root, "calls.json");
  const stream = vi.fn();
  vi.spyOn(models, "createModelRuntime").mockResolvedValue({ streamSimple: stream } as never);
  const adapter = await evalRuntime(file);
  await expect(evalRuntime(file)).rejects.toThrow("Another eval");
  adapter.close();
  await fs.writeFile(file, "broken JSON");
  await expect(evalRuntime(file)).rejects.toThrow();
  expect(stream).not.toHaveBeenCalled();
});
