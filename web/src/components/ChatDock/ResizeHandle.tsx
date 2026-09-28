// Adapted from AppSidebar/SidebarResizeHandle.tsx (same drag/keyboard resize pattern),
// but mounted on the dock's leading (start) edge with the delta inverted: the dock sits
// on the trailing side of the shell, so dragging toward the start of the screen grows it.
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
import { CHAT_DOCK_DEFAULT_WIDTH, CHAT_DOCK_WIDTH_VAR } from "./useChatDockWidth";

const KEYBOARD_STEP = 16;

interface Props {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  targetRef: RefObject<HTMLElement | null>;
}

const ResizeHandle = ({ width, minWidth, maxWidth, onWidthChange, targetRef }: Props) => {
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
        targetRef.current?.style.setProperty(CHAT_DOCK_WIDTH_VAR, `${pendingRef.current}px`);
      });
    },
    [targetRef],
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
        targetRef.current?.style.setProperty(CHAT_DOCK_WIDTH_VAR, `${originRef.current.width}px`);
      }
    },
    [stopPreview, targetRef],
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
    // Inverted: the handle sits on the dock's start edge, so moving left (negative
    // clientX delta) should widen the dock.
    const pointerDelta = originRef.current.x - event.clientX;
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
        ? width + KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? width - KEYBOARD_STEP
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
      aria-label="Resize chat"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onWidthChange(CHAT_DOCK_DEFAULT_WIDTH)}
      onKeyDown={handleKeyDown}
      className="group absolute inset-y-0 -start-1 z-10 flex w-2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
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

export default ResizeHandle;
