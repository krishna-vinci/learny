import type { SourceSummary } from "@studium/shared";
import { youtubeDirective, youtubeVideoId } from "@studium/shared/media";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function YouTubeEmbed({ id, start, end }: { id: string; start: number; end?: number }) {
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<SourceSummary>();
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/library", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const sources = (await response.json()) as SourceSummary[];
        if (!controller.signal.aborted)
          setSource(sources.find((s) => s.type === "video" && s.url && youtubeVideoId(s.url) === id));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);
  const video = youtubeDirective({ src: id, start: String(start), ...(end === undefined ? {} : { end: String(end) }) });
  if (!video) return <p className="text-sm text-muted-foreground">(video unavailable)</p>;
  const watch = `https://www.youtube.com/watch?v=${video.id}&t=${video.start}s`;
  return (
    <section className="my-4">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {playing ? (
          <iframe
            className="h-full w-full"
            title={source?.title ?? "YouTube video"}
            src={`https://www.youtube-nocookie.com/embed/${video.id}?start=${video.start}${video.end === undefined ? "" : `&end=${video.end}`}&autoplay=1`}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <>
            {source && !thumbFailed && (
              <img
                src={`/api/library/${encodeURIComponent(source.id)}/thumb`}
                alt={source.title}
                onError={() => setThumbFailed(true)}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <Button className="min-h-11" onClick={() => setPlaying(true)} aria-label="Play video">
                Play video
              </Button>
            </div>
          </>
        )}
      </div>
      <a href={watch} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm">
        Watch on YouTube
      </a>
    </section>
  );
}
