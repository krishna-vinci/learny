import type { ChapterVisual } from "@studium/shared/media";
import { assetUrl } from "@studium/shared/media";
import { layoutWidget, parseWidget, type WidgetSpec } from "@studium/shared/visuals";
import { ShapesIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { SvgSceneNode } from "./WidgetBlock";

const ArtifactBlock = lazy(() => import("./ArtifactBlock").then((module) => ({ default: module.ArtifactBlock })));

const VisualBlock = lazy(() => import("./VisualBlock").then((module) => ({ default: module.VisualBlock })));

/** Stable stage id: the file stem of the declaration's src, falling back to its 1-based index. */
function visualId(visual: ChapterVisual, index: number): string {
  const file = visual.src?.split("/").pop() ?? "";
  const stem = file.replace(/\.[^.]+$/, "");
  return stem !== "" ? stem : String(index + 1);
}

/** Rail thumbnails for widgets: fetch only the small JSON and lay out its default state. */
function useWidgetThumbnails(visuals: ChapterVisual[]): Record<string, WidgetSpec> {
  const [specs, setSpecs] = useState<Record<string, WidgetSpec>>({});
  const requested = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    for (const visual of visuals) {
      if (visual.kind !== "widget" || visual.src === undefined || requested.current.has(visual.src)) continue;
      requested.current.add(visual.src);
      const [set, ...parts] = visual.src.split("/");
      void fetch(`/api/sets/${encodeURIComponent(set ?? "")}/file?path=${encodeURIComponent(parts.join("/"))}`)
        .then(async (r) => (r.ok ? await r.json() : null))
        .then((data: unknown) => {
          if (!alive || typeof (data as { raw?: unknown })?.raw !== "string") return;
          try {
            const spec = parseWidget((data as { raw: string }).raw);
            setSpecs((prev) => ({ ...prev, [visual.src as string]: spec }));
          } catch {
            // The rail falls back to the kind icon; the stage reports the real error.
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [visuals]);
  return specs;
}

function RailCard({
  visual,
  active,
  thumb,
  onSelect,
  cardRef,
}: {
  visual: ChapterVisual;
  active: boolean;
  thumb: React.ReactNode;
  onSelect: () => void;
  cardRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`flex min-h-11 w-36 shrink-0 flex-col gap-1 rounded-lg border p-2 text-left transition-colors ${
        active ? "border-primary bg-accent" : "border-border/70 hover:bg-muted/60"
      }`}
    >
      <span className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-muted">
        {thumb ?? <ShapesIcon className="size-6 text-muted-foreground" aria-hidden />}
      </span>
      <span className="line-clamp-2 text-xs font-medium leading-snug">{visual.title}</span>
    </button>
  );
}

export function ChapterVisuals({ visuals, onRead }: { visuals: ChapterVisual[]; onRead: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const thumbnails = useWidgetThumbnails(visuals);
  const stagedIndex = useMemo(() => {
    const requested = searchParams.get("v");
    if (requested) {
      const byStem = visuals.findIndex((visual) => visual.src && visualId(visual, 0) === requested);
      if (byStem >= 0) return byStem;
      const numeric = Number.parseInt(requested, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= visuals.length) return numeric - 1;
    }
    return 0;
  }, [visuals, searchParams]);
  const staged = visuals[stagedIndex];
  const activeCard = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when the stage changes, not when the card ref identity does.
  useEffect(() => {
    // Scroll only the rail sideways: scrollIntoView would also scroll the page, and on phones the
    // rail sits below the stage, pushing the stage header under the sticky tab bar.
    const card = activeCard.current;
    const rail = card?.closest("fieldset");
    if (!card || !rail) return;
    const c = card.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    if (c.left < r.left) rail.scrollLeft -= r.left - c.left;
    else if (c.right > r.right) rail.scrollLeft += c.right - r.right;
  }, [stagedIndex]);
  function stageAt(index: number) {
    const next = visuals[index];
    if (next === undefined) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("view", "visuals");
        params.set("v", visualId(next, index));
        return params;
      },
      { preventScrollReset: true },
    );
  }
  function onKeyDown(event: React.KeyboardEvent) {
    // Plain ←/→ keep stepping scenes inside the focused widget or sketch; Shift moves the stage.
    if (!event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) return;
    event.preventDefault();
    stageAt(stagedIndex + (event.key === "ArrowRight" ? 1 : -1));
  }
  if (!visuals.length)
    return (
      <Empty className="mt-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShapesIcon />
          </EmptyMedia>
          <EmptyTitle>No visuals in this chapter yet</EmptyTitle>
          <EmptyDescription>
            Interactive figures and simulations appear here when they help explain an idea.
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" className="min-h-11" onClick={onRead}>
          Return to reading
        </Button>
      </Empty>
    );
  const nav = {
    onPrev: () => stageAt(stagedIndex - 1),
    onNext: () => stageAt(stagedIndex + 1),
    hasPrev: stagedIndex > 0,
    hasNext: stagedIndex < visuals.length - 1,
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegates Shift+←/→ staging for the whole view; focus stays in its children.
    <div className="flex flex-col gap-4 pt-4 pb-24 md:pb-4" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-2">
        <Button variant="quiet" className="min-h-11" onClick={onRead}>
          ← Back to reading
        </Button>
        <span className="text-sm text-muted-foreground">Visuals · {visuals.length} in this chapter</span>
      </div>
      {visuals.length > 1 && (
        <fieldset
          aria-label="Chapter visuals"
          // A fieldset's intrinsic min-content width would force the page wide on phones; min-w-0 lets it shrink and scroll instead.
          className="-mx-1 order-last m-0 flex min-w-0 gap-2 overflow-x-auto border-0 p-1 md:order-none"
        >
          {visuals.map((visual, index) => {
            const posterPath = visual.poster?.split("/").slice(1).join("/") ?? "";
            const spec = visual.src !== undefined ? thumbnails[visual.src] : undefined;
            return (
              <RailCard
                /* biome-ignore lint/suspicious/noArrayIndexKey: Rail order is the chapter's declaration order; duplicates only share a src, never a position. */
                key={`${visual.src ?? "unavailable"}-${index}`}
                visual={visual}
                active={index === stagedIndex}
                onSelect={() => stageAt(index)}
                cardRef={index === stagedIndex ? activeCard : undefined}
                thumb={
                  posterPath !== "" ? (
                    <img
                      className="h-20 w-full bg-white object-contain"
                      src={assetUrl({ set: visual.poster?.split("/")[0] ?? "", path: posterPath })}
                      alt=""
                      loading="lazy"
                    />
                  ) : spec !== undefined ? (
                    (() => {
                      const scene = layoutWidget(spec);
                      return (
                        <svg viewBox={`0 0 ${scene.width} ${scene.height}`} className="h-20 w-full" aria-hidden="true">
                          {scene.nodes.map((node, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: Pure geometry nodes have no component state.
                            <SvgSceneNode key={`${node.tag}-${i}`} node={node} />
                          ))}
                        </svg>
                      );
                    })()
                  ) : undefined
                }
              />
            );
          })}
        </fieldset>
      )}
      <Suspense fallback={<Skeleton className="h-[65svh] w-full" aria-label="Opening visual" />}>
        {staged === undefined ? null : staged.src === undefined ? (
          <section className="rounded-lg border border-border/70 p-4">
            <h2 className="text-lg font-semibold">{staged.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This visual is unavailable. Its chapter reference needs to be corrected.
            </p>
          </section>
        ) : staged.kind !== undefined ? (
          <VisualBlock visual={staged} nav={nav} />
        ) : (
          <ArtifactBlock src={staged.src} poster={staged.poster} title={staged.title} nav={nav} />
        )}
      </Suspense>
    </div>
  );
}
