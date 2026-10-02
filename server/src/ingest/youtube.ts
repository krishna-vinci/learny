import { youtubeVideoId } from "@studium/shared/media";
import { fetchTranscript, type TranscriptSegment, type VideoDetails } from "youtube-transcript-plus";
import { cleanMarkdown } from "./clean.js";
import { safeFetch } from "./safe-fetch.js";
import { type Extracted, UnsupportedInputError } from "./types.js";

export { youtubeVideoId } from "@studium/shared/media";

const PARAGRAPH_TARGET = 600;

/** Extract a YouTube video's captions as a transcript-tier markdown source. */
export async function extractYoutube(url: string, options: { signal?: AbortSignal } = {}): Promise<Extracted> {
  const videoId = youtubeVideoId(url);
  if (videoId === null) throw new UnsupportedInputError("youtube", `Not a recognized YouTube URL: ${url}`);

  const result = await fetchTranscript(videoId, { videoDetails: true, signal: options.signal });
  const details: VideoDetails | undefined = result.videoDetails;
  const body = transcriptToMarkdown(result.segments);
  const title = firstNonEmpty(details?.title);
  const markdown = cleanMarkdown(title === null ? body : `# ${title}\n\n${body}`);

  let thumb: Uint8Array | undefined;
  try {
    const response = await safeFetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {
      maxBytes: 5 * 1024 * 1024,
      httpsOnly: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.contentType?.split(";")[0] === "image/jpeg" && response.bytes[0] === 255 && response.bytes[1] === 216)
      thumb = response.bytes;
  } catch {
    /* A thumbnail failure must not discard a usable transcript. */
  }
  return {
    ...(thumb ? { thumb } : {}),
    title,
    authors: authorsOf(details?.author),
    markdown,
    pages: null,
    parseTier: "transcript",
    warning: body === "" ? "no transcript available" : null,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    originalExt: null,
  };
}

export function transcriptToMarkdown(segments: TranscriptSegment[]): string {
  const paragraphs: string[] = [];
  let current = "";
  let start = 0;
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (text === "") continue;
    if (current === "") start = Math.max(0, Math.floor(segment.offset));
    current = current === "" ? text : `${current} ${text}`;
    if (current.length >= PARAGRAPH_TARGET && /[.!?]["')\]]?$/.test(text)) {
      paragraphs.push(`<!-- t:${start} -->\n${current}`);
      current = "";
    }
  }
  if (current !== "") paragraphs.push(`<!-- t:${start} -->\n${current}`);
  return paragraphs.join("\n\n");
}

function firstNonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function authorsOf(author: string | null | undefined): string[] {
  return typeof author === "string" && author.trim() !== "" ? [author.trim()] : [];
}
