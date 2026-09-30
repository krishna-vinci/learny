// B1: the per-device reading-comfort preferences — text size, line width, typeface and
// line spacing — in one small module store. They persist as a single JSON blob in
// localStorage (wrapped in try/catch; when storage throws the session falls back to the
// defaults) and reach the CSS as `--reader-*` variables applied on the reader root, so
// `.studium-prose` in index.css can consume them with today's values as fallbacks.
// Slice C adds theme/accent to the same blob: unknown stored keys are preserved on save.

import type { CSSProperties } from "react";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "studium.reading-prefs";

export const READING_FONT_SIZES = [15, 16, 17, 19, 21] as const;
export const READING_MEASURES = [60, 72, 90] as const;
export const READING_TYPEFACES = ["sans", "serif"] as const;
export const READING_LEADINGS = [1.5, 1.7, 1.9] as const;
export const THEMES = ["system", "light", "dark", "sepia", "black"] as const;
export const ACCENTS = ["blue", "teal", "green", "amber", "rose", "violet"] as const;

export type ReadingFontSize = (typeof READING_FONT_SIZES)[number];
export type ReadingMeasure = (typeof READING_MEASURES)[number];
export type ReadingTypeface = (typeof READING_TYPEFACES)[number];
export type ReadingLeading = (typeof READING_LEADINGS)[number];
export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];

export interface ReadingPrefs {
  fontSize: ReadingFontSize;
  measure: ReadingMeasure;
  typeface: ReadingTypeface;
  leading: ReadingLeading;
  theme: Theme;
  accent: Accent;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontSize: 16,
  measure: 72,
  typeface: "sans",
  leading: 1.7,
  theme: "system",
  accent: "blue",
};

/** Values each stored field must match to be trusted; anything else falls back to the default. */
function pick<T extends string | number>(values: readonly T[], value: unknown, fallback: T): T {
  return (values as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

let stored: Record<string, unknown> = {};

function readStored(): ReadingPrefs {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return DEFAULT_READING_PREFS; // Storage unavailable (private mode, quota): session defaults.
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_READING_PREFS;
  stored = raw as Record<string, unknown>;
  return {
    fontSize: pick(READING_FONT_SIZES, stored.fontSize, DEFAULT_READING_PREFS.fontSize),
    measure: pick(READING_MEASURES, stored.measure, DEFAULT_READING_PREFS.measure),
    typeface: pick(READING_TYPEFACES, stored.typeface, DEFAULT_READING_PREFS.typeface),
    leading: pick(READING_LEADINGS, stored.leading, DEFAULT_READING_PREFS.leading),
    theme: pick(THEMES, stored.theme, DEFAULT_READING_PREFS.theme),
    accent: pick(ACCENTS, stored.accent, DEFAULT_READING_PREFS.accent),
  };
}

let state: ReadingPrefs = readStored();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, ...state }));
  } catch {
    // Ignore write failures: the in-memory state still applies for this session.
  }
}

export function setReadingPrefs(patch: Partial<ReadingPrefs>): void {
  state = {
    fontSize: patch.fontSize === undefined ? state.fontSize : pick(READING_FONT_SIZES, patch.fontSize, state.fontSize),
    measure: patch.measure === undefined ? state.measure : pick(READING_MEASURES, patch.measure, state.measure),
    typeface: patch.typeface === undefined ? state.typeface : pick(READING_TYPEFACES, patch.typeface, state.typeface),
    leading: patch.leading === undefined ? state.leading : pick(READING_LEADINGS, patch.leading, state.leading),
    theme: patch.theme === undefined ? state.theme : pick(THEMES, patch.theme, state.theme),
    accent: patch.accent === undefined ? state.accent : pick(ACCENTS, patch.accent, state.accent),
  };
  stored = { ...stored, ...state };
  persist();
  emit();
}

/** Back to the shipped look and clears the stored blob (unknown future keys included). */
export function resetReadingPrefs(): void {
  state = DEFAULT_READING_PREFS;
  stored = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures: the in-memory reset still applies.
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Non-React read, for callers outside the component tree (tests, key handlers). */
export function getReadingPrefs(): ReadingPrefs {
  return state;
}

export function useReadingPrefs(): ReadingPrefs {
  return useSyncExternalStore(subscribe, () => state);
}

/** The `--reader-*` variables for `.studium-prose`, spread onto the reader root element. */
export function readingPrefsVars(prefs: ReadingPrefs): CSSProperties {
  return {
    "--reader-font-size": `${prefs.fontSize}px`,
    "--reader-measure": `${prefs.measure}ch`,
    "--reader-leading": `${prefs.leading}`,
    "--reader-font": prefs.typeface === "serif" ? "var(--font-serif)" : "var(--font-sans)",
  } as CSSProperties;
}

/** "system" resolves to whatever the OS prefers; every other theme resolves to itself.
 * Used both to pick light/dark for things CSS can't theme alone (Mermaid's `theme` init
 * option) and to know which background the "Light"/"Dark" quick-toggle should land on. */
export type ResolvedTheme = "light" | "dark" | "sepia" | "black";

export function resolvedTheme(theme: Theme = getReadingPrefs().theme): ResolvedTheme {
  if (theme === "system") {
    let prefersDark = false;
    try {
      prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      // matchMedia unavailable (e.g. some test environments): fall back to light.
    }
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

/** Reacts to both the stored theme preference and OS-level `prefers-color-scheme`
 * changes, so a "system" pick keeps tracking the OS instead of freezing at mount time. */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useReadingPrefs().theme;
  return useSyncExternalStore(
    (listener) => {
      if (theme !== "system") return () => {};
      let mql: MediaQueryList | undefined;
      try {
        mql = window.matchMedia("(prefers-color-scheme: dark)");
      } catch {
        return () => {};
      }
      mql.addEventListener("change", listener);
      return () => mql?.removeEventListener("change", listener);
    },
    () => resolvedTheme(theme),
  );
}
