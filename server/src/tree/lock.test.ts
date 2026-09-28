import { describe, expect, it } from "vitest";
import { FileLocks } from "./lock";

describe("FileLocks", () => {
  it("serializes callers for the same path in call order", async () => {
    const locks = new FileLocks();
    const order: string[] = [];

    const first = locks.withLock("set/notes/a.md", "agent-1", async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 25));
      order.push("first:end");
    });
    const second = locks.withLock("set/notes/a.md", "agent-2", async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("lets different paths run concurrently", async () => {
    const locks = new FileLocks();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });

    const first = locks.withLock("set/notes/a.md", "agent-1", () => firstGate);
    const second = locks.withLock("set/notes/b.md", "agent-2", async () => {
      secondStarted();
    });

    await secondGate;
    expect(locks.holderOf("set/notes/a.md")).toBe("agent-1");
    expect(locks.holderOf("set/notes/b.md")).toBe("agent-2");

    releaseFirst();
    await Promise.all([first, second]);
  });

  it("reports the current holder and clears it when the lock is released", async () => {
    const locks = new FileLocks();
    expect(locks.holderOf("set/notes/a.md")).toBeNull();

    let observed: string | null = "unset";
    await locks.withLock("set/notes/a.md", "agent-1", async () => {
      observed = locks.holderOf("set/notes/a.md");
    });

    expect(observed).toBe("agent-1");
    expect(locks.holderOf("set/notes/a.md")).toBeNull();
  });

  it("releases the lock when the critical section rejects", async () => {
    const locks = new FileLocks();
    await expect(
      locks.withLock("set/notes/a.md", "agent-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    let ran = false;
    await locks.withLock("set/notes/a.md", "agent-2", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(locks.holderOf("set/notes/a.md")).toBeNull();
  });
});
