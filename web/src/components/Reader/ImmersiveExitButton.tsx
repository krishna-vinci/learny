// B2: the floating Exit button of the immersive reader. There is no other chrome on
// screen, so this button fades in whenever the reader shows signs of life — a scroll up,
// a tap, or a mouse move — and fades out again after a couple of idle seconds.
import { Minimize2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { exitImmersive } from "@/lib/immersive-store";
import { cn } from "@/lib/utils";

const IDLE_MS = 2500;

export function ImmersiveExitButton() {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const wake = () => {
      setVisible(true);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), IDLE_MS);
    };

    let lastY = window.scrollY;
    const onScroll = () => {
      // Scrolling down keeps the button hidden; scrolling up reveals it.
      if (window.scrollY < lastY - 1) wake();
      lastY = window.scrollY;
    };
    const onMove = () => wake();
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };

    wake();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onMove);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={exitImmersive}
      aria-label="Exit full screen"
      className={cn(
        // The button itself keeps receiving clicks while invisible only in transition;
        // pointer-events-none guarantees the idle state never blocks text selection.
        // Bottom-centre on the phone (thumb reach, clear of the note toolbar), bottom
        // end on desktop.
        "fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] start-1/2 z-50 h-11 -translate-x-1/2 gap-1.5 rounded-full bg-popover shadow-float transition-opacity duration-300",
        "md:bottom-6 md:start-auto md:end-6 md:translate-x-0 md:h-9",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <Minimize2Icon />
      Exit
    </Button>
  );
}
