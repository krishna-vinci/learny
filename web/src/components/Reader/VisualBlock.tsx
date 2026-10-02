import type { ChapterVisual } from "@studium/shared/media";
import { assetUrl, resolveNoteMedia } from "@studium/shared/media";
import { parseWidget, type WidgetSpec } from "@studium/shared/visuals";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisualPlayback } from "@/visual-runtime/playback";
import { useVisualTheme, visualStyle } from "@/visual-runtime/theme";
import { SketchBlock } from "./SketchBlock";
import {
  FULLSCREEN_SECTION,
  useVisualFullscreen,
  type VisualFailure,
  VisualFailureCard,
  VisualStrip,
  visualFailureDetail,
} from "./VisualFrame";
import { WidgetBlock, type WidgetStoryApi } from "./WidgetBlock";

export interface VisualNav {
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function VisualBlock({ visual, nav }: { visual: ChapterVisual; nav?: VisualNav }) {
  const ref = useRef<HTMLElement>(null),
    playback = useVisualPlayback(ref, visual.kind === "sketch"),
    theme = useVisualTheme(),
    { full, toggle, exitButton } = useVisualFullscreen();
  const [content, setContent] = useState<{ html: string } | { spec: WidgetSpec }>(),
    [failure, setFailure] = useState<VisualFailure>(),
    [retry, setRetry] = useState(0),
    [restart, setRestart] = useState(0),
    [live, setLive] = useState(false),
    [playing, setPlaying] = useState(true);
  const storyApi = useRef<WidgetStoryApi>(null),
    [story, setStory] = useState<{ playing: boolean; scene: number; count: number }>();
  const posterSet = visual.src?.split("/")[0] ?? "";
  const posterPath = visual.poster?.split("/").slice(1).join("/") ?? "";
  useEffect(() => {
    if (!visual.src) return;
    const [set, ...parts] = visual.src.split("/");
    const path = parts.join("/");
    if (!resolveNoteMedia(`${set}/chapter.md`, path, "visual")) {
      setFailure({ kind: "content", detail: `The visual path is not valid: ${path}` });
      return;
    }
    const controller = new AbortController();
    setFailure(undefined);
    void fetch(`/api/sets/${encodeURIComponent(set ?? "")}/file?path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
      cache: retry ? "reload" : "default",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Unavailable");
        const data = await r.json();
        if (typeof data.raw !== "string") {
          setFailure({ kind: "content", detail: "The visual file is not text" });
          return;
        }
        if (new TextEncoder().encode(data.raw).length > 300 * 1024) {
          setFailure({ kind: "content", detail: "The visual file exceeds 300 KB" });
          return;
        }
        try {
          setContent(visual.kind === "widget" ? { spec: parseWidget(data.raw) } : { html: data.raw });
          setLive(visual.kind === "widget");
        } catch (error) {
          setFailure({ kind: "content", detail: visualFailureDetail(error) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailure({ kind: "connection" });
      });
    return () => controller.abort();
  }, [visual.src, visual.kind, retry]);
  const staged = content !== undefined && failure === undefined;
  const posterLayer = (className: string) => (
    <img
      className={`absolute inset-0 h-full w-full bg-white object-contain ${className}`}
      src={assetUrl({ set: posterSet, path: posterPath })}
      alt={live ? "" : visual.title}
      {...(live ? { "aria-hidden": true } : {})}
    />
  );
  return (
    <section
      ref={ref}
      className={full ? FULLSCREEN_SECTION : "min-w-0"}
      style={visualStyle(theme)}
      aria-label={visual.title}
    >
      <h2 className="mb-3 text-lg font-semibold">{visual.title}</h2>
      {visual.kind === "sketch" && posterPath !== "" ? (
        <div className={full ? "relative min-h-0 flex-1" : "relative h-[65svh] min-h-80"}>
          {posterLayer(live ? "motion-safe:transition-opacity motion-safe:duration-200 opacity-0" : "")}
          <div className="relative h-full">
            {/* While the code/HTML opens, the poster itself is the placeholder — no skeleton on top. */}
            {failure ? (
              <VisualFailureCard
                failure={failure}
                onRetry={failure.kind === "connection" ? () => setRetry((n) => n + 1) : undefined}
              />
            ) : content !== undefined && "html" in content ? (
              <SketchBlock
                key={restart}
                html={content.html}
                title={visual.title}
                active={playback.active}
                reduced={playback.reduced}
                theme={theme}
                playing={playing}
                full={full}
                fill
                onReady={() => setLive(true)}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className={full ? "min-h-0 flex-1" : undefined}>
          {failure ? (
            <VisualFailureCard
              failure={failure}
              onRetry={failure.kind === "connection" ? () => setRetry((n) => n + 1) : undefined}
            />
          ) : content === undefined ? (
            <Skeleton className="h-[65svh] min-h-80 w-full" aria-label="Opening visual" />
          ) : "spec" in content ? (
            <WidgetBlock
              key={restart}
              spec={content.spec}
              active={playback.active}
              reduced={playback.reduced}
              full={full}
              apiRef={storyApi}
              onStoryState={setStory}
            />
          ) : (
            <SketchBlock
              key={restart}
              html={content.html}
              title={visual.title}
              active={playback.active}
              reduced={playback.reduced}
              theme={theme}
              playing={playing}
              full={full}
              onReady={() => setLive(true)}
            />
          )}
        </div>
      )}
      <VisualStrip>
        {nav?.hasPrev && (
          <Button variant="outline" className="min-h-11" aria-label="Previous visual" onClick={nav.onPrev}>
            ‹
          </Button>
        )}
        {content !== undefined && "spec" in content ? (
          <>
            <Button variant="outline" className="min-h-11" onClick={() => storyApi.current?.toggle()}>
              {story?.playing ? "Pause" : "Play"}
            </Button>
            {(story?.count ?? 0) > 1 && (
              <>
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-label="Previous scene"
                  disabled={story?.scene === 0}
                  onClick={() => storyApi.current?.step(-1)}
                >
                  ‹ scene
                </Button>
                <span className="min-w-10 text-center text-sm tabular-nums text-muted-foreground">
                  {(story?.scene ?? 0) + 1}/{story?.count}
                </span>
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-label="Next scene"
                  disabled={story?.scene === (story?.count ?? 1) - 1}
                  onClick={() => storyApi.current?.step(1)}
                >
                  scene ›
                </Button>
              </>
            )}
          </>
        ) : content !== undefined ? (
          <Button variant="outline" className="min-h-11" onClick={() => setPlaying((value) => !value)}>
            {playing ? "Pause" : "Play"}
          </Button>
        ) : null}
        {content !== undefined && (
          <Button variant="outline" className="min-h-11" onClick={() => setRestart((n) => n + 1)}>
            Restart
          </Button>
        )}
        {staged && (
          <Button ref={exitButton} className="min-h-11" variant="outline" onClick={toggle}>
            {full ? "Exit full screen" : "Full screen"}
          </Button>
        )}
        {nav?.hasNext && (
          <Button variant="outline" className="min-h-11" aria-label="Next visual" onClick={nav.onNext}>
            ›
          </Button>
        )}
      </VisualStrip>
    </section>
  );
}
