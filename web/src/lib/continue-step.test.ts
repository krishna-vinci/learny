import type { TodayItem } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { friendlyDetail, nextStep } from "./continue-step";

const item = (kind: TodayItem["kind"], overrides: Partial<TodayItem> = {}): TodayItem => ({
  kind,
  set: "alg",
  title: "t",
  detail: "Alg · 2 chapter(s) awaiting review",
  href: "/s/alg/inbox",
  ...overrides,
});

describe("nextStep", () => {
  it("uses Today's do-next item for this set, in plain words", () => {
    const step = nextStep({
      set: "alg",
      doNext: [item("inbox", { set: "other" }), item("inbox")],
      notesCount: 3,
      linkedSources: 1,
    });
    expect(step).toMatchObject({
      kind: "link",
      cta: "Review",
      href: "/s/alg/inbox",
      detail: "2 chapters waiting for you",
    });
  });

  it("turns a next-chapter item into a new-chapter action with the title prefilled", () => {
    const step = nextStep({
      set: "alg",
      doNext: [item("next-chapter", { title: "Draft 03 — Matrices", href: "/s/alg" })],
      notesCount: 2,
      linkedSources: 1,
    });
    expect(step).toMatchObject({ kind: "new-chapter", chapterTitle: "03 — Matrices" });
  });

  it("falls back from what the set contains", () => {
    expect(nextStep({ set: "alg", doNext: [], notesCount: 0, linkedSources: 0 }).kind).toBe("add-source");
    expect(nextStep({ set: "alg", doNext: [], notesCount: 0, linkedSources: 2 }).kind).toBe("new-chapter");
    expect(nextStep({ set: "alg", doNext: [], notesCount: 3, linkedSources: 2 }).kind).toBe("tutor");
  });
});

describe("friendlyDetail", () => {
  it("drops the list-style plurals", () => {
    expect(friendlyDetail("1 day(s) overdue · 4 stale card file(s)")).toBe("1 day overdue · 4 cards to refresh");
  });
});
