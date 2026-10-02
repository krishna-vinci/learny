import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SKETCH_SANDBOX, sketchDocument, visualMessage } from "@/visual-runtime/sandbox";
import type { VisualTheme } from "@/visual-runtime/theme";
export function SketchBlock({
  html,
  title,
  active,
  reduced,
  theme,
}: {
  html: string;
  title: string;
  active: boolean;
  reduced: boolean;
  theme: VisualTheme;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [manifest, setManifest] = useState<Record<string, string>>(),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/visual-runtime/manifest.json", {
      credentials: "omit",
      signal: controller.signal,
      cache: retry ? "reload" : "default",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Runtime unavailable");
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          !Object.values(data).every((v) => typeof v === "string")
        )
          throw new Error("Invalid manifest");
        setManifest(data as Record<string, string>);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [retry]);
  const document = useMemo(() => {
    if (!manifest) return;
    try {
      return sketchDocument(html, location.origin, manifest);
    } catch {
      return null;
    }
  }, [html, manifest]);
  const controls = useRef({ active, reduced, theme });
  controls.current = { active, reduced, theme };
  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "studium-visual-control", ...controls.current }, "*");
  }, []);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "studium-visual-control", active, reduced, theme }, "*");
  }, [active, reduced, theme]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = visualMessage(event, frame.current?.contentWindow ?? null);
      if (message?.event === "ready") {
        send();
        setError(false);
      } else if (message?.event === "error") setError(true);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [send]);
  if (error || document === null)
    return (
      <div className="flex h-[65svh] min-h-80 flex-col items-center justify-center gap-4 rounded-lg border border-border/70">
        <p role="alert" className="text-sm text-muted-foreground">
          This visual couldn't be opened. Connect and try again.
        </p>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setError(false);
            setRetry((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  return (
    <iframe
      ref={frame}
      className="h-[65svh] min-h-80 w-full rounded-lg border border-border/70"
      sandbox={SKETCH_SANDBOX}
      srcDoc={document ?? ""}
      title={title}
      referrerPolicy="no-referrer"
      onLoad={send}
    />
  );
}
