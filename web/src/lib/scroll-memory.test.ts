import { afterEach, describe, expect, it, vi } from "vitest";
import { readScrollPosition, saveScrollPosition } from "./scroll-memory";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("scroll memory", () => {
  it("round-trips a position per set and path", () => {
    expect(readScrollPosition("linalg", "notes/03-svd.md")).toBeNull();

    saveScrollPosition("linalg", "notes/03-svd.md", 421.9);

    expect(readScrollPosition("linalg", "notes/03-svd.md")).toBe(421);
    expect(readScrollPosition("linalg", "notes/02-matrices.md")).toBeNull();
  });

  it("ignores nonsense positions", () => {
    saveScrollPosition("linalg", "notes/03-svd.md", Number.NaN);
    saveScrollPosition("linalg", "notes/03-svd.md", -5);
    expect(readScrollPosition("linalg", "notes/03-svd.md")).toBeNull();

    sessionStorage.setItem("studium.note-scroll:linalg/notes/03-svd.md", "not-a-number");
    expect(readScrollPosition("linalg", "notes/03-svd.md")).toBeNull();
  });

  it("survives storage failures without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });

    expect(() => saveScrollPosition("linalg", "notes/03-svd.md", 100)).not.toThrow();
    expect(readScrollPosition("linalg", "notes/03-svd.md")).toBeNull();
  });
});
