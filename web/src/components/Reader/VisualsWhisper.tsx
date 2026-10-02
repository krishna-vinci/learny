import { Button } from "@/components/ui/button";

/** One muted line at the end of the reading panel pointing at the chapter's Visuals tab.
 * The tab label already shows the count above; this is the in-prose pointer at the end. */
export function VisualsWhisper({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <Button variant="quiet" className="mt-8 min-h-11 px-0 text-sm" onClick={onOpen}>
      Explore this chapter's {count} {count === 1 ? "visual" : "visuals"} →
    </Button>
  );
}
