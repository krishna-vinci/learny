import { beforeEach, describe, expect, it } from "vitest";
import { claimHint, dismissHint, releaseHint, resetHints } from "./hints";

beforeEach(() => {
  localStorage.clear();
  resetHints();
});

describe("first-use hints", () => {
  it("shows at most one hint at a time", () => {
    expect(claimHint("select-text")).toBe(true);
    expect(claimHint("card-keys")).toBe(false);
    releaseHint("select-text");
    expect(claimHint("card-keys")).toBe(true);
  });

  it("never shows a dismissed hint again and remembers it", () => {
    claimHint("select-text");
    dismissHint("select-text");
    expect(claimHint("select-text")).toBe(false);
    expect(JSON.parse(localStorage.getItem("studium.hints-dismissed") ?? "[]")).toEqual(["select-text"]);
  });
});
