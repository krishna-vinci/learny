import type { ChapterMedia } from "@studium/shared";
import { parseYoutubeVideo } from "@studium/shared/media";

/** The same learner-facing status in Course plan and the full Plan page. */
export function ChapterMediaStatus({ media }: { media?: ChapterMedia }) {
  if (!media || (!media.visuals.length && !media.video.intent && media.video.status === "planned")) return null;
  const made = media.visuals.filter((v) => v.made).length;
  const video = media.video;
  const watch = video.url && parseYoutubeVideo(video.url) ? video.url : null;
  return (
    <div className="mt-1 flex flex-col gap-1 break-words text-xs text-muted-foreground">
      {media.visuals.length > 0 && (
        <>
          <p>
            Visuals: {made}/{media.visuals.length} made
          </p>
          <ul className="flex flex-col gap-0.5">
            {media.visuals.map((visual) => (
              <li key={visual.intent}>
                {visual.intent} · {visual.made ? "Made" : visual.reason ? `Unavailable: ${visual.reason}` : "Planned"}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        {video.status === "chosen" ? (
          <>
            Video chosen:{" "}
            {watch ? (
              <a href={watch} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {video.title ?? "Watch video"}
              </a>
            ) : (
              video.title
            )}
            {video.channel && ` · ${video.channel}`}
            {video.moment && ` · ${video.moment}`}
          </>
        ) : video.status === "none" ? (
          `No suitable video: ${video.reason ?? "None passed the quality checks."}`
        ) : (
          `Video planned: ${video.intent}`
        )}
      </p>
    </div>
  );
}
