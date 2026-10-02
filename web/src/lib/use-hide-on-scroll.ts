import { useEffect, useState } from "react";

/** True while the page is scrolling down past `offset`; false as soon as it scrolls up. */
export function useHideOnScroll(enabled: boolean, offset = 120): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (Math.abs(y - last) < 8) return;
        setHidden(y > last && y > offset);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, offset]);
  return hidden;
}
