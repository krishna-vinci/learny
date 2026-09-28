import { fetchTranscript, type TranscriptSegment, type VideoDetails } from "youtube-transcript-plus";
import { cleanMarkdown } from "./clean.js";
import { type Extracted, UnsupportedInputError } from "./types.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PARAGRAPH_TARGET = 600;

/** Pull the 11-character video id out of the common YouTube URL shapes. */
export function youtubeVideoId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return VIDEO_ID.test(value.trim()) ? value.trim() : null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") return firstPathSegment(url.pathname);
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    if (url.pathname === "/watch") return videoIdOrNull(url.searchParams.get("v"));
    const fromPath = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (fromPath?.[1] !== undefined) return fromPath[1];
  }
  return null;
}

/** Extract a YouTube video's captions as a transcript-tier markdown source. */
export async function extractYoutube(url: string, options: { signal?: AbortSignal } = {}): Promise<Extracted> {
  const videoId = youtubeVideoId(url);
  if (videoId === null) throw new UnsupportedInputError("youtube", `Not a recognized YouTube URL: ${url}`);

  const result = await fetchTranscript(url, { videoDetails: true, signal: options.signal });
  const details: VideoDetails | undefined = result.videoDetails;
  const body = transcriptToMarkdown(result.segments);
  const title = firstNonEmpty(details?.title);
  const markdown = cleanMarkdown(title === null ? body : `# ${title}\n\n${body}`);

  return {
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

function transcriptToMarkdown(segments: TranscriptSegment[]): string {
  const paragraphs: string[] = [];
  let current = "";
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (text === "") continue;
    current = current === "" ? text : `${current} ${text}`;
    if (current.length >= PARAGRAPH_TARGET && /[.!?]["')\]]?$/.test(text)) {
      paragraphs.push(current);
      current = "";
    }
  }
  if (current !== "") paragraphs.push(current);
  return paragraphs.join("\n\n");
}

function firstPathSegment(pathname: string): string | null {
  const segment = pathname.split("/").filter((part) => part !== "")[0];
  return segment === undefined ? null : videoIdOrNull(segment);
}

function videoIdOrNull(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && VIDEO_ID.test(value) ? value : null;
}

function firstNonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function authorsOf(author: string | null | undefined): string[] {
  return typeof author === "string" && author.trim() !== "" ? [author.trim()] : [];
}
