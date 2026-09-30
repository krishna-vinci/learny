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

export type ReadingFontSize = (typeof READING_FONT_SIZES)[number];
export type ReadingMeasure = (typeof READING_MEASURES)[number];
export type ReadingTypeface = (typeof READING_TYPEFACES)[number];
export type ReadingLeading = (typeof READING_LEADINGS)[number];

export interface ReadingPrefs {
  fontSize: ReadingFontSize;
  measure: ReadingMeasure;
  typeface: ReadingTypeface;
  leading: ReadingLeading;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  fontSize: 16,
  measure: 72,
  typeface: "sans",
  leading: 1.7,
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
