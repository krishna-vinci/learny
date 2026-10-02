import { layoutWidget, type WidgetSpec, widgetScenes } from "@studium/shared/visuals";
import type { SvgNode, VisualState } from "@studium/shared/visuals/common";
import { year } from "@studium/shared/visuals/timeline";
import { createElement, type Ref, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStory } from "./StoryControls";
export function SvgSceneNode({ node }: { node: SvgNode }) {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]),
  );
  return createElement(
    node.tag,
    attrs,
    node.text,
    node.children?.map(
      (n, i /* biome-ignore lint/suspicious/noArrayIndexKey: Pure SVG nodes have no component state. */) => (
        <SvgSceneNode key={`${n.tag}-${i}`} node={n} />
      ),
    ),
  );
}
/** Story control surface for the parent-side strip: same React tree, no message protocol. */
export interface WidgetStoryApi {
  toggle(): void;
  step(delta: number): void;
}

export function WidgetBlock({
  spec,
  active = false,
  reduced = false,
  full = false,
  apiRef,
  onStoryState,
}: {
  spec: WidgetSpec;
  active?: boolean;
  reduced?: boolean;
  full?: boolean;
  apiRef?: Ref<WidgetStoryApi>;
  onStoryState?: (state: { playing: boolean; scene: number; count: number }) => void;
}) {
  const scenes = useMemo(() => widgetScenes(spec), [spec]);
  const story = useStory(scenes, active, reduced);
  useImperativeHandle(
    apiRef,
    () => ({ toggle: () => story.toggle(), step: (delta: number) => story.go(story.scene + delta) }),
    [story],
  );
  useEffect(() => {
    onStoryState?.({ playing: story.playing, scene: story.scene, count: scenes.length });
  }, [onStoryState, story.playing, story.scene, scenes.length]);
  const [params, setParams] = useState<VisualState>({});
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A scene change clears overrides so its authored state applies.
  useEffect(() => setParams({}), [story.scene]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Each story scene starts its own identity-to-transform animation.
  useEffect(() => {
    if (spec.type !== "matrix-transform" || !story.playing || reduced) return;
    const start = performance.now();
    let raf = 0;
    const tick = (time: number) => {
      setProgress(Math.min(1, (time - start) / 1200));
      if (time - start < 1200) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec.type, story.playing, story.scene, reduced]);
  const state: VisualState = {
    ...(scenes[story.scene]?.state ?? {}),
    ...(spec.type === "matrix-transform" ? { progress: reduced ? 1 : progress } : {}),
    ...params,
  };
  const scene = layoutWidget(spec, state);
  const dates = spec.type === "timeline" ? spec.events.map((event) => year(event.date)) : [];
  const selected = spec.type === "timeline" ? spec.events[Number(state.selected ?? 0)] : undefined;
  const param = (name: string, value: number) => setParams((p) => ({ ...p, [name]: value }));
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border/70 bg-background${full ? " flex h-full min-h-0 flex-col" : ""}`}
      role="application"
      /* biome-ignore lint/a11y/noNoninteractiveTabindex: Interactive SVG simulation exposes arrow and space shortcuts on focus. */
      tabIndex={0}
      onKeyDown={(e) => {
        if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
        if (e.key === "ArrowRight") story.go(story.scene + 1);
        else if (e.key === "ArrowLeft") story.go(story.scene - 1);
        else if (e.code === "Space") story.toggle();
        else return;
        e.preventDefault();
      }}
      aria-label={`${spec.title} controls`}
    >
      <div
        className={
          full
            ? "flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            : "flex h-[min(55svh,32rem)] min-h-72 items-center justify-center overflow-hidden"
        }
      >
        <svg
          className="max-h-full w-full"
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          role="img"
          aria-label={spec.title}
        >
          <title>{spec.title}</title>
          <g fill="var(--visual-fg, currentColor)" fontFamily="var(--visual-font, system-ui)" fontSize={26}>
            {scene.nodes.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Pure geometry nodes have no component state.
              <SvgSceneNode key={`${n.tag}-${i}`} node={n} />
            ))}
          </g>
        </svg>
      </div>
      {spec.type === "function-plot" &&
        spec.params.map((p) => (
          <label key={p.name} className="flex min-h-11 items-center gap-3 px-3">
            <span className="min-w-16 text-sm">
              {p.name}: {Number(state[p.name] ?? p.value).toFixed(2)}
            </span>
            <input
              type="range"
              className="h-11 min-w-0 flex-1 accent-primary"
              aria-label={p.name}
              min={p.min}
              max={p.max}
              step={p.step ?? (p.max - p.min) / 100}
              value={Number(state[p.name] ?? p.value)}
              onChange={(e) => param(p.name, Number(e.target.value))}
            />
          </label>
        ))}
      {spec.type === "matrix-transform" && (
        <label className="flex min-h-11 items-center gap-3 px-3">
          <span className="text-sm">Transform</span>
          <input
            className="h-11 min-w-0 flex-1 accent-primary"
            type="range"
            aria-label="Transform"
            min={0}
            max={1}
            step={0.01}
            value={Number(state.progress ?? 1)}
            onChange={(e) => param("progress", Number(e.target.value))}
          />
        </label>
      )}
      {spec.type === "timeline" && (
        <div className="flex flex-col gap-2 px-3">
          <label className="flex min-h-11 items-center gap-3">
            Zoom
            <input
              type="range"
              className="h-11 min-w-0 flex-1 accent-primary"
              min={1}
              max={10}
              step={0.1}
              aria-label="Zoom"
              value={Number(state.zoom ?? 1)}
              onChange={(e) => param("zoom", Number(e.target.value))}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            Centre year
            <input
              type="range"
              className="h-11 min-w-0 flex-1 accent-primary"
              aria-label="Centre year"
              min={Math.min(...dates)}
              max={Math.max(...dates)}
              step={0.1}
              value={Number(state.center ?? (Math.min(...dates) + Math.max(...dates)) / 2)}
              onChange={(e) => param("center", Number(e.target.value))}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3">
            Event
            <select
              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background p-2"
              aria-label="Selected event"
              value={Number(state.selected ?? 0)}
              onChange={(e) => param("selected", Number(e.target.value))}
            >
              {spec.events.map((event, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Event order is fixed for this visual.
                <option key={`${i}-${event.title}`} value={i}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <Card>
              <CardHeader>
                <CardTitle>{selected.title}</CardTitle>
                <CardDescription>
                  {typeof selected.date === "number" && selected.date < 0
                    ? `${Math.abs(selected.date)} BCE`
                    : String(selected.date)}{" "}
                  · {selected.category}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{selected.description ?? scene.caption}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {/* Play/pause and scene stepping live in the parent-side strip; the narration stays. */}
      {scenes.length > 1 && (
        <p className="min-h-12 px-3 pb-3 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
          {scenes[story.scene]?.narration}
        </p>
      )}
    </div>
  );
}
