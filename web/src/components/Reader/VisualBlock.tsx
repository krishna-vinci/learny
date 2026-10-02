import type { ChapterVisual } from "@studium/shared/media";
import { resolveNoteMedia } from "@studium/shared/media";
import { parseWidget, type WidgetSpec } from "@studium/shared/visuals";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisualPlayback } from "@/visual-runtime/playback";
import { useVisualTheme, visualStyle } from "@/visual-runtime/theme";
import { SketchBlock } from "./SketchBlock";
import { WidgetBlock } from "./WidgetBlock";
export function VisualBlock({ visual }: { visual: ChapterVisual }) {
  const ref = useRef<HTMLElement>(null),
    playback = useVisualPlayback(ref, visual.kind === "sketch"),
    theme = useVisualTheme();
  const [content, setContent] = useState<{ html: string } | { spec: WidgetSpec }>(),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!visual.src) return;
    const [set, ...parts] = visual.src.split("/");
    const path = parts.join("/");
    if (!resolveNoteMedia(`${set}/chapter.md`, path, "visual")) {
      setError(true);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/sets/${encodeURIComponent(set ?? "")}/file?path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
      cache: retry ? "reload" : "default",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Unavailable");
        const data = await r.json();
        if (typeof data.raw !== "string" || new TextEncoder().encode(data.raw).length > 300 * 1024)
          throw new Error("Invalid visual");
        setContent(visual.kind === "widget" ? { spec: parseWidget(data.raw) } : { html: data.raw });
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [visual.src, visual.kind, retry]);
  return (
    <section ref={ref} className="min-w-0" style={visualStyle(theme)} aria-label={visual.title}>
      <h2 className="mb-3 text-lg font-semibold">{visual.title}</h2>
      {error ? (
        <div className="flex h-[65svh] min-h-80 flex-col items-center justify-center gap-4 rounded-lg border border-border/70">
          <p role="alert" className="text-sm text-muted-foreground">
            This visual couldn't be opened. Connect and try again.
          </p>
          <Button variant="outline" className="min-h-11" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !content ? (
        <Skeleton className="h-[65svh] min-h-80 w-full" aria-label="Opening visual" />
      ) : "spec" in content ? (
        <WidgetBlock spec={content.spec} active={playback.active} reduced={playback.reduced} />
      ) : (
        <SketchBlock
          html={content.html}
          title={visual.title}
          active={playback.active}
          reduced={playback.reduced}
          theme={theme}
        />
      )}
    </section>
  );
}
