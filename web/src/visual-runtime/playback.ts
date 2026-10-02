import { type RefObject, useEffect, useState } from "react";

const sketches = new Map<object, { ratio: number; notify: () => void }>();
let winner: object | undefined;
function choose() {
  winner = undefined;
  let score = 0.49;
  for (const [id, value] of sketches)
    if (value.ratio > score) {
      winner = id;
      score = value.ratio;
    }
  for (const value of sketches.values()) value.notify();
}
export function useVisualPlayback(ref: RefObject<HTMLElement | null>, sketch: boolean) {
  const [ratio, setRatio] = useState(0),
    [selected, setSelected] = useState(false),
    [hidden, setHidden] = useState(document.hidden),
    [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
    [phone, setPhone] = useState(() => window.matchMedia?.("(max-width: 767px)").matches ?? false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = {};
    if (sketch) sketches.set(id, { ratio: 0, notify: () => setSelected(winner === id) });
    const observer = new IntersectionObserver(
      (entries) => {
        const next = entries[0]?.intersectionRatio ?? 0;
        setRatio(next);
        if (sketch) {
          const entry = sketches.get(id);
          if (entry) entry.ratio = next;
          choose();
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(el);
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)"),
      mobile = window.matchMedia?.("(max-width: 767px)");
    const onMotion = () => setReduced(motion?.matches ?? false),
      onPhone = () => setPhone(mobile?.matches ?? false);
    motion?.addEventListener("change", onMotion);
    mobile?.addEventListener("change", onPhone);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion?.removeEventListener("change", onMotion);
      mobile?.removeEventListener("change", onPhone);
      sketches.delete(id);
      choose();
    };
  }, [ref, sketch]);
  return { active: ratio >= 0.5 && !hidden && (!sketch || !phone || selected), reduced, visible: ratio > 0 };
}
