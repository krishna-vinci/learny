import { describe, expect, it } from "vitest";
import { formatCost, formatEstimate, formatTokenCount } from "./job-format";

describe("formatCost", () => {
  it("shows no dollar amount for subscription billing", () => {
    expect(formatCost(0.04, "subscription")).toBe("subscription");
    expect(formatCost(null, "subscription")).toBe("subscription");
  });

  it("shows the dollar amount for metered billing", () => {
    expect(formatCost(0.04, "metered")).toBe("$0.04");
  });

  it("shows the dollar amount plus subscription for mixed billing", () => {
    expect(formatCost(0.04, "mixed")).toBe("~$0.04 + subscription");
  });
});

describe("formatEstimate", () => {
  it("formats a mixed-billing estimate with tokens and cost", () => {
    expect(formatEstimate({ tokens: 12345, costUsd: 0.04, billing: "mixed" })).toBe(
      `≈${formatTokenCount(12345)} tokens · ~$0.04 + subscription`,
    );
  });

  it("falls back to subscription when billing is omitted and cost is zero", () => {
    expect(formatEstimate({ tokens: 900, costUsd: 0 })).toBe(`≈${formatTokenCount(900)} tokens · subscription`);
  });
});
