/** Parent→frame control message (`{type:"studium-visual-control", …}`), shared by the React side,
 * the bundled runtime and tests. Unknown fields are ignored for forward compatibility; a known
 * field with the wrong type makes the whole message malformed so the runtime ignores it. */
export interface VisualControlTheme {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  grid: string;
  font: string;
  palette: string[];
}

export interface VisualControl {
  active?: boolean;
  reduced?: boolean;
  playing?: boolean;
  theme?: VisualControlTheme;
}

export function parseVisualControl(data: unknown): VisualControl | null {
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== "studium-visual-control") return null;
  const d = data as Record<string, unknown>;
  const optional = (key: string): boolean | null | undefined => {
    if (d[key] === undefined) return undefined;
    return typeof d[key] === "boolean" ? (d[key] as boolean) : null; // null ⇒ malformed
  };
  const active = optional("active");
  const reduced = optional("reduced");
  const playing = optional("playing");
  if (active === null || reduced === null || playing === null) return null;
  let theme: VisualControlTheme | undefined;
  if (d.theme !== undefined) {
    const t = d.theme as Record<string, unknown>;
    const valid =
      !!t &&
      typeof t === "object" &&
      ["bg", "fg", "muted", "accent", "grid", "font"].every((k) => typeof t[k] === "string") &&
      Array.isArray(t.palette) &&
      t.palette.every((x) => typeof x === "string");
    if (!valid) return null;
    theme = {
      bg: t.bg as string,
      fg: t.fg as string,
      muted: t.muted as string,
      accent: t.accent as string,
      grid: t.grid as string,
      font: t.font as string,
      palette: t.palette as string[],
    };
  }
  return {
    ...(active !== undefined ? { active } : {}),
    ...(reduced !== undefined ? { reduced } : {}),
    ...(playing !== undefined ? { playing } : {}),
    ...(theme !== undefined ? { theme } : {}),
  };
}
