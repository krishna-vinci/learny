import { assetUrl } from "@studium/shared/media";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export const ARTIFACT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

export function ArtifactBlock({
  src,
  poster,
  title = "Interactive figure",
}: {
  src: string;
  poster?: string;
  title?: string;
}) {
  const [html, setHtml] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [full, setFull] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [set, ...parts] = src.split("/");
  const path = parts.join("/");
  useEffect(() => {
    if (!full) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [full]);
  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/sets/${encodeURIComponent(set ?? "")}/file?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error("unavailable");
      const data = (await response.json()) as { raw?: unknown };
      if (typeof data.raw !== "string" || new TextEncoder().encode(data.raw).length > 300 * 1024)
        throw new Error("invalid artifact");
      setHtml(ARTIFACT_CSP + data.raw);
    } catch {
      setError(
        navigator.onLine === false
          ? "This figure needs a connection. Connect and try again."
          : "This figure couldn't be opened. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const body = (
    <section className={full ? "fixed inset-0 z-50 flex flex-col bg-background p-4" : "my-4"} aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        {html && (
          <Button className="min-h-11" variant="outline" onClick={() => setFull(!full)}>
            {full ? "Exit full screen" : "Full screen"}
          </Button>
        )}
      </div>
      <div className={full ? "min-h-0 flex-1" : "relative aspect-[16/10] overflow-hidden rounded-lg bg-muted"}>
        {html !== undefined ? (
          <iframe
            className="h-full w-full border-0"
            sandbox="allow-scripts"
            srcDoc={html}
            referrerPolicy="no-referrer"
            title={title}
          />
        ) : (
          <>
            {poster && !posterFailed && (
              <img
                className="h-full w-full bg-white object-contain"
                src={assetUrl({ set: set ?? "", path: poster.split("/").slice(1).join("/") })}
                alt={title}
                loading="lazy"
                onError={() => setPosterFailed(true)}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <Button className="min-h-11" onClick={() => void run()} disabled={busy}>
                {busy ? "Opening…" : error ? "Try again" : "Run"}
              </Button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {error}
        </p>
      )}
    </section>
  );
  return full ? createPortal(body, document.body) : body;
}
