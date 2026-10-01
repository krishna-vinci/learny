import { expect, it } from "vitest";
import { concurrencyLimit, mapConcurrent } from "./concurrency.js";

it("limits active operations to four and releases a slot after failure", async () => {
  const limit = concurrencyLimit(4);
  let active = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const work = Array.from({ length: 9 }, (_, index) =>
    limit(async () => {
      active++;
      peak = Math.max(active, peak);
      try {
        await new Promise<void>((resolve) => releases.push(resolve));
        if (index === 0) throw new Error("failure");
        return index;
      } finally {
        active--;
      }
    }),
  );
  const settled = Promise.allSettled(work);
  expect(active).toBe(4);
  for (let i = 0; i < 9; i++) {
    releases.shift()?.();
    // Drain the promise continuation and slot hand-off without wall-clock sleeps.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const results = await settled;
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(peak).toBe(4);
  expect(active).toBe(0);
});

it("bounds filesystem mapping while preserving enumeration order", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (value) => {
    active++;
    peak = Math.max(active, peak);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    active--;
    return value * 2;
  });
  expect(results).toEqual([0, 2, 4, 6, 8, 10]);
  expect(peak).toBe(2);
});
