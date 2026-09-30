// Slice C: applies the persisted theme/accent preference to the DOM and keeps the phone
// status bar (`<meta name="theme-color">`) in sync with the resolved background. The
// no-flash inline script in index.html does the same `data-theme`/`data-accent` write
// before first paint (from raw localStorage, no imports allowed there) — this module
// takes over from React so later changes (including "system" following an OS toggle)
// keep applying without a reload.
import { useEffect } from "react";
import { useReadingPrefs, useResolvedTheme } from "./reading-prefs";

/** Reads the theme's `--background` straight off `:root` after the attributes are set,
 * so the status bar always matches what actually rendered — including the ~sepia/black
 * exact tones — without hand-duplicating the palette here. */
function syncThemeColorMeta(): void {
  let background: string | undefined;
  try {
    background = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  } catch {
    return;
  }
  if (!background) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", background);
}

/** Mounted once (RootLayout) to keep `document.documentElement`'s `data-theme`/
 * `data-accent` and the status-bar colour in sync with the reading-prefs store. */
export function useApplyTheme(): void {
  const { theme, accent } = useReadingPrefs();
  const resolved = useResolvedTheme();

  // `resolved` isn't read in the body, but it's a deliberate dependency: when "system" is
  // selected and the OS scheme flips, the attributes below don't change, yet the CSS that
  // applies under prefers-color-scheme does — so the status bar still needs a re-read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resolved is a re-run trigger, not a value read in the body
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
    syncThemeColorMeta();
  }, [theme, accent, resolved]);
}
