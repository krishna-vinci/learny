import type { VisualState } from "@studium/shared/visuals/common";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
export interface StoryScene {
  state: VisualState;
  narration: string;
}
export function useStory(scenes: StoryScene[], active: boolean, reduced: boolean) {
  const [scene, setScene] = useState(0),
    [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    if (reduced) {
      setPlaying(false);
      setScene(0);
    }
  }, [reduced]);
  useEffect(() => {
    if (!active || !playing || reduced || scenes.length < 2) return;
    const timer = setInterval(
      () =>
        setScene((i) => {
          if (i >= scenes.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      4000,
    );
    return () => clearInterval(timer);
  }, [active, playing, reduced, scenes.length]);
  const go = (i: number) => {
    setPlaying(false);
    setScene(Math.max(0, Math.min(scenes.length - 1, i)));
  };
  return { scene, playing: active && playing && !reduced, toggle: () => setPlaying((p) => !p), go };
}
export function StoryControls({
  scenes,
  scene,
  playing,
  onGo,
  onToggle,
}: {
  scenes: StoryScene[];
  scene: number;
  playing: boolean;
  onGo: (i: number) => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11" disabled={scene === 0} onClick={() => onGo(scene - 1)}>
          Previous
        </Button>
        <Button variant="outline" className="min-h-11" onClick={onToggle}>
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={scene >= scenes.length - 1}
          onClick={() => onGo(scene + 1)}
        >
          Next
        </Button>
        <label className="flex min-w-24 flex-1 items-center gap-2">
          <span className="sr-only">Scene</span>
          <input
            className="h-11 w-full accent-primary"
            type="range"
            min={0}
            max={Math.max(0, scenes.length - 1)}
            step={1}
            value={scene}
            onChange={(e) => onGo(Number(e.target.value))}
          />
        </label>
      </div>
      {scenes.length > 1 && (
        <fieldset className="flex flex-wrap gap-2" aria-label="Scenes">
          {scenes.map((s, i) => (
            <Button
              /* biome-ignore lint/suspicious/noArrayIndexKey: Scenes have fixed order and remount with the visual. */
              key={`${i}-${s.narration}`}
              aria-label={`Scene ${i + 1}`}
              aria-pressed={i === scene}
              variant="quiet"
              className="min-h-11 min-w-11"
              onClick={() => onGo(i)}
            >
              {i + 1}
            </Button>
          ))}
        </fieldset>
      )}
      <p className="min-h-12 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
        {scenes[scene]?.narration}
      </p>
    </div>
  );
}
