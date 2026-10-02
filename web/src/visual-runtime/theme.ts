import { type CSSProperties, useEffect, useState } from "react";
export interface VisualTheme {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  grid: string;
  font: string;
  palette: string[];
  dark: boolean;
}
export function readVisualTheme(): VisualTheme {
  const css = getComputedStyle(document.documentElement);
  const color = (key: string, fallback: string) => css.getPropertyValue(`--${key}`).trim() || fallback;
  const name = document.documentElement.dataset.theme;
  const dark =
    name === "dark" ||
    name === "black" ||
    ((name === "system" || !name) && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return {
    bg: color("background", "#fafaf9"),
    fg: color("foreground", "#292524"),
    muted: color("muted-foreground", "#57534e"),
    accent: color("primary", "#0072B2"),
    grid: color("border", "#d6d3d1"),
    font:
      getComputedStyle(document.body).fontFamily ||
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    palette: dark
      ? ["#56B4E9", "#E69F00", "#6DCDB0", "#E5A2CD", "#F0E442", "#8DD1F0", "#F0E442", "#f4f4f4"]
      : ["#0072B2", "#B84300", "#007F5D", "#A54D86", "#9B6B00", "#007FA5", "#857A00", "#292524"],
    dark,
  };
}
export function useVisualTheme() {
  const [theme, setTheme] = useState(readVisualTheme);
  useEffect(() => {
    const update = () => setTheme(readVisualTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent", "style"],
    });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      scheme?.removeEventListener("change", update);
    };
  }, []);
  return theme;
}
export function visualStyle(theme: VisualTheme): CSSProperties {
  return {
    "--visual-bg": theme.bg,
    "--visual-fg": theme.fg,
    "--visual-grid": theme.grid,
    "--visual-font": theme.font,
    ...Object.fromEntries(theme.palette.map((color, i) => [`--visual-color-${i}`, color])),
  } as CSSProperties;
}
