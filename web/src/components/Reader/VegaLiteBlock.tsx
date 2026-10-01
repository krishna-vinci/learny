import { useEffect, useRef, useState } from "react";
import { RenderBoundary } from "@/components/RenderBoundary";

function Chart({ code }: { code: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let cancelled = false;
    let view: { finalize(): unknown } | undefined;
    let generation = 0;
    async function draw() {
      const current = ++generation;
      try {
        const { createChartView } = await import("@/lib/vega-loader");
        if (cancelled || generation !== current || !el) return;
        view?.finalize();
        el.replaceChildren();
        const css = getComputedStyle(document.documentElement);
        const color = (name: string, fallback: string) => css.getPropertyValue(`--${name}`).trim() || fallback;
        const chart = createChartView(
          code,
          el.clientWidth || 360,
          {
            foreground: color("foreground", "#292524"),
            background: color("background", "#fafaf9"),
            accent: color("primary", "#2b4a6f"),
            border: color("border", "#d6d3d1"),
          },
          el,
        );
        view = chart;
        await chart.runAsync();
        if (!cancelled && generation === current) setError(false);
      } catch {
        if (!cancelled && generation === current) {
          el?.replaceChildren();
          setError(true);
        }
      }
    }
    void draw();
    const observer = new MutationObserver(() => void draw());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent", "style"],
    });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => void draw());
    resize?.observe(el);
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", draw);
    return () => {
      cancelled = true;
      generation++;
      observer.disconnect();
      resize?.disconnect();
      scheme?.removeEventListener("change", draw);
      view?.finalize();
    };
  }, [code]);
  return (
    <div className="my-4 max-w-full overflow-x-auto" role="img" aria-label="Data chart">
      <div ref={container} />
      {error && (
        <>
          <pre>
            <code className="language-vega-lite">{code}</code>
          </pre>
          <p className="text-sm text-muted-foreground">Chart couldn't be drawn</p>
        </>
      )}
    </div>
  );
}
export function VegaLiteBlock({ code }: { code: string }) {
  return (
    <RenderBoundary fallbackText={code} resetKey={code}>
      <Chart code={code} />
    </RenderBoundary>
  );
}
