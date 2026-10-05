import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ExaBudget, subscribeExaStop } from "./budget.js";

const roots: string[] = [];
async function root(config = "") {
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "studium-budget-"));
  roots.push(r);
  await fs.mkdir(path.join(r, "_global"));
  await fs.writeFile(path.join(r, "_global/config.yaml"), config);
  return r;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});
it("accumulates reported spend across restarts, warns, stops and notifies once per UTC month", async () => {
  const r = await root("search:\n  exa:\n    warnUsd: 0.005\n    stopUsd: 0.01\n");
  let now = new Date("2026-10-31T23:59:00Z");
  const clock = () => now;
  const notify = vi.fn(async () => {
    throw new Error("channel down");
  });
  const unsubscribe = subscribeExaStop(r, notify);
  try {
    await new ExaBudget(r, clock).run(async () => ({ costUsd: 0.007 }));
    expect(await new ExaBudget(r, clock).status()).toMatchObject({ spendUsd: 0.007, status: "warning" });
    await new ExaBudget(r, clock).run(async () => ({ costUsd: 0.007 }));
    const call = vi.fn(async () => ({ costUsd: 0.007 }));
    await expect(new ExaBudget(r, clock).run(call)).rejects.toThrow("budget stopped");
    expect(call).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    now = new Date("2026-11-01T00:00:00Z");
    expect(await new ExaBudget(r, clock).status()).toMatchObject({ spendUsd: 0, month: "2026-11", status: "ready" });
    await new ExaBudget(r, clock).run(async () => ({ costUsd: 0.011 }));
    expect(notify).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
  }
});
it("serializes concurrent service instances before authorizing another paid call", async () => {
  const r = await root("search:\n  exa:\n    stopUsd: 0.005\n");
  const call = vi.fn(async () => ({ costUsd: 0.007 }));
  const results = await Promise.allSettled([new ExaBudget(r).run(call), new ExaBudget(r).run(call)]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(call).toHaveBeenCalledTimes(1);
});
it("fails closed for unknown cost or corrupted persistence without losing previously recorded spend", async () => {
  const r = await root();
  const budget = new ExaBudget(r);
  await budget.run(async () => ({ costUsd: 0.007 }));
  await budget.run(async () => ({ costUsd: 0, costReported: false }));
  expect(await new ExaBudget(r).status()).toMatchObject({ spendUsd: 0.007, status: "unavailable" });
  await expect(new ExaBudget(r).run(async () => ({ costUsd: 1 }))).rejects.toThrow();
  await fs.writeFile(path.join(r, ".cache/exa-budget.json"), "broken");
  expect((await budget.status()).status).toBe("unavailable");
  const call = vi.fn();
  await expect(budget.run(call)).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it("does not follow cache symlinks and uses tolerant defaults", async () => {
  const r = await root("search:\n  exa:\n    warnUsd: wrong\n    stopUsd: -2\n");
  expect(await new ExaBudget(r).status()).toMatchObject({ warnUsd: 8, stopUsd: 9.5 });
  const outside = await root();
  await fs.rmdir(path.join(r, ".cache"));
  await fs.symlink(outside, path.join(r, ".cache"));
  const call = vi.fn();
  await expect(new ExaBudget(r).run(call)).rejects.toThrow("Unsafe");
  expect(call).not.toHaveBeenCalled();
  expect(await fs.readdir(outside)).toEqual(["_global"]);
});

it("refuses an unresolved paid request marker after a restart", async () => {
  const r = await root();
  await new ExaBudget(r).run(async () => ({ costUsd: 0.007 }));
  const file = path.join(r, ".cache/exa-budget.json");
  const ledger = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, JSON.stringify({ ...ledger, inFlight: true }));
  expect(await new ExaBudget(r).status()).toMatchObject({ status: "unavailable", spendUsd: 0.007 });
  const call = vi.fn();
  await expect(new ExaBudget(r).run(call)).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
