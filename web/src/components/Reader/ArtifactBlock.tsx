import { assetUrl, resolveNoteMedia } from "@studium/shared/media";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { VisualNav } from "./VisualBlock";
import { FULLSCREEN_SECTION, useVisualFullscreen, VisualStrip } from "./VisualFrame";

export const ARTIFACT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;

export function ArtifactBlock({
  src,
  poster,
  title = "Interactive figure",
  nav,
}: {
  src: string;
  poster?: string;
  title?: string;
  nav?: VisualNav;
}) {
  const [html, setHtml] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [posterFailed, setPosterFailed] = useState(false);
  const { full, toggle, exitButton } = useVisualFullscreen();
  const [set, ...parts] = src.split("/");
  const path = parts.join("/");
  const valid = resolveNoteMedia(`${set}/chapter.md`, path, "html");
  const validPoster = poster
    ? resolveNoteMedia(`${set}/chapter.md`, poster.split("/").slice(1).join("/"), "poster")
    : null;
  async function run() {
    if (!valid || (poster && (poster.split("/")[0] !== set || !validPoster))) return;
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
  if (!valid || (poster && (poster.split("/")[0] !== set || !validPoster)))
    return <p className="text-sm text-muted-foreground">This visual is unavailable.</p>;
  return (
    <section className={full ? FULLSCREEN_SECTION : "min-w-0"} aria-label={title}>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <div
        className={
          full
            ? "min-h-0 flex-1"
            : "relative h-[65svh] min-h-80 overflow-hidden rounded-lg border border-border/70 bg-muted"
        }
      >
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
            {poster && !posterFailed && !busy && (
              <img
                className="h-full w-full bg-white object-contain"
                src={assetUrl({ set: set ?? "", path: poster.split("/").slice(1).join("/") })}
                alt={title}
                loading="lazy"
                onError={() => setPosterFailed(true)}
              />
            )}
            {busy && <Skeleton className="absolute inset-0 size-full" />}
            <div className="absolute inset-0 flex items-center justify-center">
              <Button variant="outline" className="min-h-11" onClick={() => void run()} disabled={busy}>
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
      <VisualStrip>
        {nav?.hasPrev && (
          <Button variant="outline" className="min-h-11" aria-label="Previous visual" onClick={nav.onPrev}>
            ‹
          </Button>
        )}
        {html !== undefined && (
          <Button variant="outline" className="min-h-11" onClick={() => setHtml(undefined)}>
            Restart
          </Button>
        )}
        {html !== undefined && (
          <Button ref={exitButton} className="min-h-11" variant="outline" onClick={toggle}>
            {full ? "Exit full screen" : "Full screen"}
          </Button>
        )}
        {nav?.hasNext && (
          <Button variant="outline" className="min-h-11" aria-label="Next visual" onClick={nav.onNext}>
            ›
          </Button>
        )}
      </VisualStrip>
    </section>
  );
}
