import type { StudiumEvent } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { EventHub } from "./events.js";

const fileEvent: StudiumEvent = {
  type: "file",
  set: "linear-algebra",
  path: "linear-algebra/notes/01-vectors.md",
  change: "change",
};

describe("EventHub", () => {
  it("delivers a published event to every subscriber", () => {
    const hub = new EventHub();
    const a: StudiumEvent[] = [];
    const b: StudiumEvent[] = [];
    hub.subscribe((e) => a.push(e));
    hub.subscribe((e) => b.push(e));

    hub.publish(fileEvent);

    expect(a).toEqual([fileEvent]);
    expect(b).toEqual([fileEvent]);
  });

  it("stops delivery after unsubscribe", () => {
    const hub = new EventHub();
    const seen: StudiumEvent[] = [];
    const unsubscribe = hub.subscribe((e) => seen.push(e));

    hub.publish(fileEvent);
    unsubscribe();
    hub.publish(fileEvent);

    expect(seen).toEqual([fileEvent]);
  });
});
