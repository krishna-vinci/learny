import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READING_PREFS,
  getReadingPrefs,
  readingPrefsVars,
  resetReadingPrefs,
  resolvedTheme,
  setReadingPrefs,
} from "./reading-prefs";

afterEach(() => {
  resetReadingPrefs();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("reading prefs store", () => {
  it("starts at the defaults and persists changes to localStorage", () => {
    expect(getReadingPrefs()).toEqual(DEFAULT_READING_PREFS);

    setReadingPrefs({ fontSize: 21, typeface: "serif" });

    expect(getReadingPrefs()).toEqual({ ...DEFAULT_READING_PREFS, fontSize: 21, typeface: "serif" });
    expect(JSON.parse(localStorage.getItem("studium.reading-prefs") ?? "{}")).toMatchObject({
      fontSize: 21,
      typeface: "serif",
    });
  });

  it("falls back to the defaults for invalid or out-of-set stored values", async () => {
    localStorage.setItem(
      "studium.reading-prefs",
      JSON.stringify({
        fontSize: 999,
        measure: "wide",
        typeface: "comic",
        leading: 3,
        theme: "purple",
        accent: "puce",
      }),
    );
    vi.resetModules();
    const fresh = await import("./reading-prefs");

    expect(fresh.getReadingPrefs()).toEqual(fresh.DEFAULT_READING_PREFS);
  });

  it("reads and persists theme and accent alongside the reading-comfort fields", () => {
    expect(getReadingPrefs()).toMatchObject({ theme: "system", accent: "blue" });

    setReadingPrefs({ theme: "sepia", accent: "rose" });

    expect(getReadingPrefs()).toMatchObject({ theme: "sepia", accent: "rose" });
    expect(JSON.parse(localStorage.getItem("studium.reading-prefs") ?? "{}")).toMatchObject({
      theme: "sepia",
      accent: "rose",
    });
  });

  it("resolves system to light or dark via matchMedia, and leaves other themes alone", () => {
    const matchMedia = (matches: boolean) =>
      vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() });

    vi.stubGlobal("matchMedia", matchMedia(true));
    expect(resolvedTheme("system")).toBe("dark");

    vi.stubGlobal("matchMedia", matchMedia(false));
    expect(resolvedTheme("system")).toBe("light");

    expect(resolvedTheme("sepia")).toBe("sepia");
    expect(resolvedTheme("black")).toBe("black");
    vi.unstubAllGlobals();
  });

  it("keeps a working in-memory store when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });

    setReadingPrefs({ measure: 90 });
    expect(getReadingPrefs()).toEqual({ ...DEFAULT_READING_PREFS, measure: 90 });
  });

  it("reads a store that throws on getItem as the defaults", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    vi.resetModules();
    const fresh = await import("./reading-prefs");

    expect(fresh.getReadingPrefs()).toEqual(fresh.DEFAULT_READING_PREFS);
  });

  it("preserves unknown stored keys so Slice C can share the same blob", async () => {
    localStorage.setItem("studium.reading-prefs", JSON.stringify({ theme: "sepia", fontSize: 19 }));
    vi.resetModules();
    const fresh = await import("./reading-prefs");

    fresh.setReadingPrefs({ leading: 1.9 });

    const stored = JSON.parse(localStorage.getItem("studium.reading-prefs") ?? "{}");
    expect(stored).toMatchObject({ theme: "sepia", fontSize: 19, leading: 1.9 });
  });

  it("reset restores the defaults and clears the stored blob", () => {
    setReadingPrefs({ fontSize: 15, measure: 60, typeface: "serif", leading: 1.5 });

    resetReadingPrefs();

    expect(getReadingPrefs()).toEqual(DEFAULT_READING_PREFS);
    expect(localStorage.getItem("studium.reading-prefs")).toBeNull();
  });

  it("maps prefs to the --reader-* CSS variables", () => {
    expect(
      readingPrefsVars({ fontSize: 19, measure: 60, typeface: "serif", leading: 1.9, theme: "system", accent: "blue" }),
    ).toEqual({
      "--reader-font-size": "19px",
      "--reader-measure": "60ch",
      "--reader-leading": "1.9",
      "--reader-font": "var(--font-serif)",
    });
  });
});
