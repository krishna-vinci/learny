import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  private handlers: ((event: MessageEvent<string>) => void)[] = [];
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(_type: string, handler: (event: MessageEvent<string>) => void) {
    this.handlers.push(handler);
  }
  emit(data: unknown) {
    for (const handler of this.handlers) handler({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  close() {
    this.closed = true;
  }
}

describe("subscribeStudiumEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shares one connection across subscribers and closes it when the last one leaves", async () => {
    const { subscribeStudiumEvents } = await import("./events");
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeStudiumEvents(a);
    const offB = subscribeStudiumEvents(b);
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]?.emit({ type: "commit", sha: "abc", subject: "s", author: "tutor" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);
    offB();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });
});
