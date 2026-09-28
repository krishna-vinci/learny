// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Upstream reads text direction from @base-ui/react/direction-provider and labels via
// i18n; this app is LTR-only with inline English strings, so both are dropped.
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_VAR } from "./useSidebarWidth";

const KEYBOARD_STEP = 16;

interface Props {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  targetRef: RefObject<HTMLElement | null>;
  cssVariable?: string;
  defaultWidth?: number;
}

const SidebarResizeHandle = ({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  targetRef,
  cssVariable = SIDEBAR_WIDTH_VAR,
  defaultWidth = SIDEBAR_DEFAULT_WIDTH,
}: Props) => {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef(width);
  const originRef = useRef({ x: 0, width });

  const clamp = useCallback(
    (next: number) => Math.min(Math.max(Math.round(next), minWidth), maxWidth),
    [minWidth, maxWidth],
  );

  const previewWidth = useCallback(
    (next: number) => {
      pendingRef.current = next;
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        targetRef.current?.style.setProperty(cssVariable, `${pendingRef.current}px`);
      });
    },
    [targetRef, cssVariable],
  );

  const stopPreview = useCallback(() => {
    if (frameRef.current == null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopPreview();
      if (draggingRef.current) {
        targetRef.current?.style.setProperty(cssVariable, `${originRef.current.width}px`);
      }
    },
    [stopPreview, targetRef, cssVariable],
  );

  useEffect(() => {
    if (!dragging) return;
    const { body } = document;
    const previousCursor = body.style.cursor;
    const previousUserSelect = body.style.userSelect;
    body.style.cursor = "col-resize";
    body.style.userSelect = "none";
    return () => {
      body.style.cursor = previousCursor;
      body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    originRef.current = { x: event.clientX, width };
    pendingRef.current = width;
    draggingRef.current = true;
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const pointerDelta = event.clientX - originRef.current.x;
    previewWidth(clamp(originRef.current.width + pointerDelta));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopPreview();
    draggingRef.current = false;
    setDragging(false);
    onWidthChange(pendingRef.current);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? width - KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? width + KEYBOARD_STEP
          : event.key === "Home"
            ? minWidth
            : event.key === "End"
              ? maxWidth
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onWidthChange(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: this is a draggable/keyboard-resizable handle, not a static <hr>.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onWidthChange(defaultWidth)}
      onKeyDown={handleKeyDown}
      className="group absolute inset-y-0 -end-1 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
    >
      <div
        className={cn(
          "h-full w-0.5 transition-colors",
          dragging ? "bg-primary/70" : "bg-transparent group-hover:bg-border group-focus-visible:bg-primary/70",
        )}
      />
    </div>
  );
};

export default SidebarResizeHandle;
