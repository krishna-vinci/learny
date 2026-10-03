// KaTeX (JS + CSS, ~300 kB) is only fetched when a note or message actually contains math
// (docs/UX.md section 6). `remark-math` is small and always on; the rendering plugin loads on demand.
import { useEffect, useState } from "react";

type RehypeKatexPlugin = typeof import("rehype-katex").default;
type KatexOptions = NonNullable<Parameters<RehypeKatexPlugin>[0]>;
type Transformer = (tree: unknown, file: unknown) => unknown;
/** A unified plugin with the same shape as rehype-katex, made crash-safe. */
export type RehypeKatex = (options?: KatexOptions) => Transformer;

/**
 * - `output: "html"`: KaTeX's MathML copy is skipped. rehype-katex turns KaTeX's HTML into hast
 *   through the browser DOM, and on iOS/WebKit the MathML namespace path crashed the whole page
 *   ("e is not an Object … `children` in e") while rendering a tutor answer. HTML output renders
 *   identically and avoids that path.
 * - Any failure leaves the math as source text instead of taking down the page.
 */
export const KATEX_OPTIONS: KatexOptions = { output: "html", strict: false };

function safe(plugin: RehypeKatexPlugin): RehypeKatex {
  return (options) => {
    const transform = plugin({ ...KATEX_OPTIONS, ...options }) as unknown as Transformer;
    return (tree, file) => {
      try {
        return transform(tree, file);
      } catch (error) {
        console.warn("studium: math rendering failed; showing the source instead", error);
        return tree;
      }
    };
  };
}

let cached: RehypeKatex | null = null;
let pending: Promise<RehypeKatex> | null = null;

export function loadKatex(): Promise<RehypeKatex> {
  pending ??= Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => {
      cached = safe(module.default);
      return cached;
    },
    (error: unknown) => {
      // A failed chunk download (offline, or an old app version after a deploy) must not stick:
      // forget it so the next note retries.
      pending = null;
      throw error;
    },
  );
  return pending;
}

/** True for `$x$`, `$$…$$`, `\(…\)` and `\[…\]`: a cheap test, false positives only cost one fetch. */
export function hasMath(text: string): boolean {
  return /\$[^$\n]+\$|\$\$|\\\(|\\\[/.test(text);
}

export type KatexState = { plugin: RehypeKatex | null; failed: boolean };

/** The KaTeX rehype plugin once loaded. `failed` turns true when it couldn't be downloaded, so the
 * caller renders the note with math as source text instead of waiting forever. */
export function useKatex(needed: boolean): KatexState {
  const [plugin, setPlugin] = useState<RehypeKatex | null>(cached);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!needed || plugin) return;
    let cancelled = false;
    loadKatex().then(
      (loaded) => {
        if (!cancelled) setPlugin(() => loaded);
      },
      (error: unknown) => {
        console.warn("studium: math renderer unavailable; showing math as text", error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needed, plugin]);
  return { plugin: needed ? plugin : null, failed: needed && !plugin && failed };
}
