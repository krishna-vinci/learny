// KaTeX (JS + CSS, ~300 kB) is only fetched when a note or message actually contains math
// (docs/UX.md section 6). `remark-math` is small and always on; the rendering plugin loads on demand.
import { useEffect, useState } from "react";

type RehypeKatex = typeof import("rehype-katex").default;

let cached: RehypeKatex | null = null;
let pending: Promise<RehypeKatex> | null = null;

export function loadKatex(): Promise<RehypeKatex> {
  pending ??= Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")]).then(([module]) => {
    cached = module.default;
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
