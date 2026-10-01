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
  pending ??= Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")]).then(([module]) => {
    cached = safe(module.default);
    return cached;
  });
  return pending;
}

/** True for `$x$`, `$$…$$`, `\(…\)` and `\[…\]`: a cheap test, false positives only cost one fetch. */
export function hasMath(text: string): boolean {
  return /\$[^$\n]+\$|\$\$|\\\(|\\\[/.test(text);
}

/** The KaTeX rehype plugin once loaded; `null` until then (and forever when `needed` is false). */
export function useKatex(needed: boolean): RehypeKatex | null {
  const [plugin, setPlugin] = useState<RehypeKatex | null>(cached);
  useEffect(() => {
    if (!needed || plugin) return;
    let cancelled = false;
    void loadKatex().then((loaded) => {
      if (!cancelled) setPlugin(() => loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [needed, plugin]);
  return needed ? plugin : null;
}
