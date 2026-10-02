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
it("reserves each request and resumes telemetry beyond the old 200-call limit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-budget-"));
  roots.push(root);
  const file = path.join(root, "calls.json");
  await fs.writeFile(file, JSON.stringify({ calls: 200, usage: {} }));
  const message = {
    usage: { input: 7, output: 3, cacheRead: 11, cacheWrite: 0 },
    content: [{ type: "text", text: "ok" }],
    stopReason: "stop",
  };
  const stream = vi.fn(() => ({ result: async () => message }));
  const runtime = { streamSimple: stream, getModel: () => ({ provider: "github-copilot", id: "test" }) };
  vi.spyOn(models, "createModelRuntime").mockResolvedValue(runtime as never);
  const adapter = await evalRuntime(file);
  expect(await adapter.judge("github-copilot/test", "judge")).toBe("ok");
  expect(adapter.state).toEqual({
    calls: 201,
    usage: { "github-copilot": { fresh: 7, output: 3, cacheRead: 11, cacheWrite: 0 } },
  });
  adapter.close();
  vi.mocked(models.createModelRuntime).mockResolvedValue({ ...runtime, streamSimple: stream } as never);
  const resumed = await evalRuntime(file);
  expect(await resumed.judge("github-copilot/test", "again")).toBe("ok");
  expect(resumed.state.calls).toBe(202);
  resumed.close();
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
    getModel: () => ({ provider: "openai-codex", id: "m" }),
  } as never);
  const adapter = await evalRuntime(path.join(root, "calls.json"));
  adapter.beginTurn();
  await expect(adapter.judge("openai-codex/m", "rubric", "fake-image")).rejects.toThrow("unavailable");
  await expect(adapter.judge("openai-codex/m", "rubric", "fake-image")).rejects.toThrow("unavailable");
  await expect(adapter.judge("openai-codex/m", "rubric", "fake-image")).rejects.toThrow("unavailable");
  await expect(adapter.judge("openai-codex/m", "rubric", "fake-image")).rejects.toThrow("three identical failures");
  expect(adapter.state.calls).toBe(3);
  adapter.close();
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

it("stops repeated tool errors without recounting old context messages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-loop-"));
  roots.push(root);
  const stream = vi.fn(() => ({
    result: async () => ({
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      stopReason: "stop",
      content: [],
    }),
  }));
  vi.spyOn(models, "createModelRuntime").mockResolvedValue({ streamSimple: stream } as never);
  const adapter = await evalRuntime(path.join(root, "calls.json"));
  const errors = [1, 2, 3].map((i) => ({
    role: "toolResult",
    toolCallId: String(i),
    toolName: "study_edit",
    isError: true,
    content: [{ type: "text", text: "no match" }],
    timestamp: 0,
  }));
  const send = (messages: unknown[]) =>
    adapter.runtime.streamSimple({ provider: "openai-codex" } as never, { messages } as never);
  send(errors.slice(0, 1));
  send(errors.slice(0, 1));
  send(errors.slice(0, 2));
  expect(() => send(errors)).toThrow("three identical failures");
  expect(stream).toHaveBeenCalledTimes(3);
  adapter.beginTurn();
  expect(() => send([])).not.toThrow();
  expect(() => adapter.runtime.streamSimple({ provider: "paid" } as never, { messages: [] } as never)).toThrow(
    "authorized subscription",
  );
  adapter.close();
});

it.each(["throw", "reject"])("counts a provider %s toward the three-identical-failures guard", async (kind) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-provider-loop-"));
  roots.push(root);
  const stream = vi.fn(() => {
    if (kind === "throw") throw new Error("provider unavailable");
    return {
      result: async () => {
        throw new Error("provider unavailable");
      },
    };
  });
  vi.spyOn(models, "createModelRuntime").mockResolvedValue({
    streamSimple: stream,
    getModel: () => ({ provider: "openai-codex", id: "test" }),
  } as never);
  const adapter = await evalRuntime(path.join(root, "calls.json"));
  for (let i = 0; i < 3; i++)
    await expect(adapter.judge("openai-codex/test", "judge")).rejects.toThrow("provider unavailable");
  await expect(adapter.judge("openai-codex/test", "judge")).rejects.toThrow("three identical failures");
  expect(stream).toHaveBeenCalledTimes(3);
  expect(adapter.state.calls).toBe(3);
  adapter.close();
});
