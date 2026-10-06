import { assetUrl, resolveNoteMedia } from "@studium/shared/media";

const TRAILING_URL = /(https?:\/\/\S+)$/;

/** A credit ends with its source URL; render that part as a real link. */
function CreditText({ credit }: { credit: string }) {
  const match = TRAILING_URL.exec(credit);
  if (!match?.[1]) return <>{credit}</>;
  const url = match[1];
  return (
    <>
      {credit.slice(0, match.index)}
      <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {url}
      </a>
    </>
  );
}

export function NoteImage({
  src,
  alt,
  title,
  notePath,
  localOnly = false,
}: {
  src?: string;
  alt?: string;
  title?: string;
  notePath?: string;
  localOnly?: boolean;
}) {
  const media = src ? resolveNoteMedia(notePath, src) : null;
  const url = media ? assetUrl(media) : !localOnly && src?.startsWith("https:") ? src : null;
  if (!url) return <span>{alt}</span>;
  return (
    <span className="my-4 block">
      <img
        src={url}
        alt={alt ?? ""}
        title={title}
        loading="lazy"
        decoding="async"
        className={`mx-auto max-w-full${media?.path.endsWith(".svg") ? " bg-white" : ""}`}
      />
      {(title || alt) && (
        <span className="mt-2 block text-center text-sm text-muted-foreground">
          <CreditText credit={title || alt || ""} />
        </span>
      )}
    </span>
  );
}
