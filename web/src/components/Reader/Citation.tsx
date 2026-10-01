// Studium-specific source citation popover; not derived from Memos.
import { formatMediaTime, youtubeVideoId } from "@studium/shared/media";
import { type ReactNode, useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function Citation({
  src,
  page,
  time,
  children,
}: {
  src: string;
  page: string;
  time?: string;
  children?: ReactNode;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!time) return;
    const controller = new AbortController();
    void fetch(`/api/library/${encodeURIComponent(src)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { source?: { url?: string } };
        const id = data.source?.url ? youtubeVideoId(data.source.url) : null;
        if (id && !controller.signal.aborted) setUrl(`https://www.youtube.com/watch?v=${id}`);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [src, time]);
  const timestamp = time ? formatMediaTime(Number(time)) : "";
  const label = time ? `${src}, at ${timestamp}` : `${src}, p.${page}`;
  const watch = url ? `${url}${url.includes("?") ? "&" : "?"}t=${time}s` : undefined;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<sup className="citation-ref cursor-help" title={label} />}>{children}</TooltipTrigger>
        <TooltipContent>
          {label}
          {time && watch && (
            <a className="block" href={watch} target="_blank" rel="noreferrer">
              Watch on YouTube at {timestamp}
            </a>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
