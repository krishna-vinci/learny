import type { CardStatus, CardView } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { criticLabel, filterCardsByStatus, nextCardIndex, renderClozeText, statusChips } from "./cards-utils";

describe("renderClozeText", () => {
  it("hides cloze content behind a blank when not revealed", () => {
    expect(renderClozeText("The SVD factors $A$ into {{c1::$U\\Sigma V^\\top$}}.", false)).toBe(
      "The SVD factors $A$ into [...].",
    );
  });

  it("uses the hint instead of an ellipsis when one is given", () => {
    expect(renderClozeText("Water freezes at {{c1::0::temperature}}°C.", false)).toBe(
      "Water freezes at [temperature]°C.",
    );
  });

  it("reveals the cloze content in bold when revealed", () => {
    expect(renderClozeText("The SVD factors $A$ into {{c1::$U\\Sigma V^\\top$}}.", true)).toBe(
      "The SVD factors $A$ into **$U\\Sigma V^\\top$**.",
    );
  });

  it("handles multiple clozes in one string", () => {
    expect(renderClozeText("{{c1::A}} then {{c2::B}}", false)).toBe("[...] then [...]");
  });
});

describe("statusChips", () => {
  it("drops zero counts and keeps a fixed status order", () => {
    const counts: Record<CardStatus, number> = { draft: 2, approved: 0, rejected: 1, exported: 0 };
    expect(statusChips(counts)).toEqual([
      { status: "draft", count: 2 },
      { status: "rejected", count: 1 },
    ]);
  });
});

describe("nextCardIndex", () => {
  it("wraps forward past the last card to the first", () => {
    expect(nextCardIndex(3, 2, 1)).toBe(0);
  });

  it("wraps backward past the first card to the last", () => {
    expect(nextCardIndex(3, 0, -1)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(nextCardIndex(0, 0, 1)).toBe(0);
  });
});

describe("filterCardsByStatus", () => {
  const cards: CardView[] = [
    { id: "c-1", type: "basic", status: "draft" },
    { id: "c-2", type: "basic", status: "approved" },
    { id: "c-3", type: "cloze", status: "draft" },
  ];

  it("keeps only cards matching the filter", () => {
    expect(filterCardsByStatus(cards, "draft").map((c) => c.id)).toEqual(["c-1", "c-3"]);
  });

  it("returns every card for 'all'", () => {
    expect(filterCardsByStatus(cards, "all").map((c) => c.id)).toEqual(["c-1", "c-2", "c-3"]);
  });
});

describe("criticLabel", () => {
  it("returns null when there is no critic verdict", () => {
    expect(criticLabel(undefined)).toBeNull();
  });

  it("returns 'ok' for a clean verdict", () => {
    expect(criticLabel({ verdict: "ok" })).toBe("ok");
  });

  it("formats a rejection with rule and reason", () => {
    expect(criticLabel({ verdict: "reject", rule: 4, reason: "too many facts" })).toBe("Rule 4: too many facts");
  });
});
