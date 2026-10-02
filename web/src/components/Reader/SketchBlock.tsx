import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SKETCH_SANDBOX, sketchDocument, visualMessage } from "@/visual-runtime/sandbox";
import type { VisualTheme } from "@/visual-runtime/theme";
import { type VisualFailure, VisualFailureCard, visualFailureDetail } from "./VisualFrame";

export function SketchBlock({
  html,
  title,
  active,
  reduced,
  theme,
  playing = true,
  full = false,
  fill = false,
  onReady,
}: {
  html: string;
  title: string;
  active: boolean;
  reduced: boolean;
  theme: VisualTheme;
  /** Parent-side play/pause: extends the validated control message; the in-frame chrome stays. */
  playing?: boolean;
  full?: boolean;
  /** Fill a sized parent (the poster wrapper) instead of sizing itself. */
  fill?: boolean;
  onReady?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string>();
  const [failure, setFailure] = useState<VisualFailure>();
  const [retry, setRetry] = useState(0);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailure(undefined);
    void fetch("/visual-runtime/manifest.json", {
      credentials: "omit",
      signal: controller.signal,
      cache: retry ? "reload" : "default",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Runtime unavailable");
        let data: unknown;
        try {
          data = await response.json();
        } catch (error) {
          setFailure({ kind: "content", detail: visualFailureDetail(error) });
          return;
        }
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          !Object.values(data).every((v) => typeof v === "string")
        ) {
          setFailure({ kind: "content", detail: "The runtime manifest is not valid" });
          return;
        }
        try {
          setSrcDoc(sketchDocument(html, location.origin, data as Record<string, string>));
        } catch (error) {
          setFailure({ kind: "content", detail: visualFailureDetail(error) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailure({ kind: "connection" });
      });
    return () => controller.abort();
  }, [html, retry]);
  const controls = useRef({ active, reduced, theme, playing });
  controls.current = { active, reduced, theme, playing };
  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "studium-visual-control", ...controls.current }, "*");
  }, []);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "studium-visual-control", active, reduced, theme, playing }, "*");
  }, [active, reduced, theme, playing]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = visualMessage(event, frame.current?.contentWindow ?? null);
      if (message?.event === "ready") {
        send();
        setFailure(undefined);
        onReady?.();
      } else if (message?.event === "error") {
        setFailure({ kind: "runtime", detail: visualFailureDetail(message.message) });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [send, onReady]);
  if (failure)
    return (
      <VisualFailureCard
        failure={failure}
        onRetry={
          failure.kind === "connection"
            ? () => {
                setFailure(undefined);
                setRetry((n) => n + 1);
              }
            : undefined
        }
        onRestart={
          failure.kind === "runtime"
            ? () => {
                setFailure(undefined);
                setRestart((n) => n + 1);
              }
            : undefined
        }
      />
    );
  if (srcDoc === undefined) return <Skeleton className="h-[65svh] min-h-80 w-full" aria-label="Opening visual" />;
  return (
    <iframe
      key={restart}
      ref={frame}
      className={
        full
          ? "h-full min-h-0 w-full"
          : fill
            ? "h-full min-h-80 w-full"
            : "h-[65svh] min-h-80 w-full rounded-lg border border-border/70"
      }
      sandbox={SKETCH_SANDBOX}
      srcDoc={srcDoc}
      title={title}
      referrerPolicy="no-referrer"
      onLoad={send}
    />
  );
}
