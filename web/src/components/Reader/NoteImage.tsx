import { assetUrl, resolveNoteMedia } from "@studium/shared/media";

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
      {(title || alt) && <span className="mt-2 block text-center text-sm text-muted-foreground">{title || alt}</span>}
    </span>
  );
}
