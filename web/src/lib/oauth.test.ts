import { describe, expect, it } from "vitest";
import { safeReturnUrl } from "./oauth";

describe("safeReturnUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeReturnUrl("/s/demo?tab=notes")).toBe("/s/demo?tab=notes");
  });

  it("rejects absolute, scheme-relative and backslash targets", () => {
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/\t/evil.test",
      "javascript:alert(1)",
      null,
    ]) {
      expect(safeReturnUrl(bad)).toBe("/");
    }
  });
});
