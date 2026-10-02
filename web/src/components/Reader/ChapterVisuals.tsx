import type { ChapterVisual } from "@studium/shared/media";
import { ShapesIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

const ArtifactBlock = lazy(() => import("./ArtifactBlock").then((module) => ({ default: module.ArtifactBlock })));

const VisualBlock = lazy(() => import("./VisualBlock").then((module) => ({ default: module.VisualBlock })));

export function ChapterVisuals({ visuals, onRead }: { visuals: ChapterVisual[]; onRead: () => void }) {
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
  return (
    <div className="flex flex-col gap-8 pt-6">
      <p className="text-sm text-muted-foreground">
        Explore at your own pace. Step through a story or adjust its controls.
      </p>
      {visuals.map((visual, index) =>
        visual.src ? (
          <Suspense key={visual.src} fallback={<Skeleton className="h-[65svh] w-full" aria-label="Opening visual" />}>
            {visual.kind ? (
              <VisualBlock visual={visual} />
            ) : (
              <ArtifactBlock src={visual.src} poster={visual.poster} title={visual.title} />
            )}
          </Suspense>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: Unavailable entries have no state; the list remounts when chapter content changes.
          <section key={`unavailable-${index}`} className="rounded-lg border border-border/70 p-4">
            <h2 className="text-lg font-semibold">{visual.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This visual is unavailable. Its chapter reference needs to be corrected.
            </p>
          </section>
        ),
      )}
    </div>
  );
}
