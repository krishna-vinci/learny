import type { ChapterMedia } from "@studium/shared";
import { parseYoutubeVideo } from "@studium/shared/media";

/** The same learner-facing status in Course plan and the full Plan page. */
export function ChapterMediaStatus({ media }: { media?: ChapterMedia }) {
  if (!media || (!media.visuals.length && !media.video.intent && media.video.status === "planned")) return null;
  const pictures = media.visuals.filter((visual) => !visual.interactive);
  const interactive = media.visuals.filter((visual) => visual.interactive);
  const count = (list: typeof media.visuals) => `${list.filter((visual) => visual.made).length}/${list.length} made`;
  const video = media.video;
  const watch = video.url && parseYoutubeVideo(video.url) ? video.url : null;
  return (
    <div className="mt-1 flex flex-col gap-1 break-words text-xs text-muted-foreground">
      {media.visuals.length > 0 && (
        <>
          <p>
            {pictures.length > 0 && `Pictures in text: ${count(pictures)}`}
            {pictures.length > 0 && interactive.length > 0 && " · "}
            {interactive.length > 0 && `Visuals tab: ${count(interactive)}`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {media.visuals.map((visual) => (
              <li key={visual.intent}>
                {visual.intent}
                {visual.interactive && " (Visuals tab)"} ·{" "}
                {visual.made ? "Made" : visual.reason ? `Unavailable: ${visual.reason}` : "Planned"}
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
