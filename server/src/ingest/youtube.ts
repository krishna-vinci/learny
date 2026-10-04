import type { YoutubeTranscriptStatus } from "@studium/shared";
import { youtubeVideoId } from "@studium/shared/media";
import { fetchTranscript, type TranscriptSegment, type VideoDetails } from "youtube-transcript-plus";
import type {
  EngineSegment,
  TranscriptAttempt,
  TranscriptFailureKind,
  YoutubeTranscriptEngine,
} from "../youtube/types.js";
import { cleanMarkdown } from "./clean.js";
import { safeFetch } from "./safe-fetch.js";
import { type Extracted, UnsupportedInputError } from "./types.js";

export { youtubeVideoId } from "@studium/shared/media";

const PARAGRAPH_TARGET = 600;

const YOUTUBE_MEDIA_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "i.ytimg.com",
] as const;

/**
 * Owner-approved plain-language warnings. `parse_warning` stores the
 * admin-facing copy; members see a derived "ask your admin" variant in the UI.
 */
export const TRANSCRIPT_WARNINGS: Record<string, string> = {
  blocked: "YouTube blocked the transcript for this video — try again later, or set up YouTube sign-in in Settings",
  unavailable:
    "YouTube couldn't provide the transcript for this video — try again later, or set up YouTube sign-in in Settings",
  "no-captions": "This video has no captions",
  disabled: "Captions are turned off by the uploader",
};

/** Frontmatter value persisted for embed-only video sources. */
export type TranscriptStatus = YoutubeTranscriptStatus;

export interface YoutubeExtractOptions {
  signal?: AbortSignal;
  /** Optional instance YouTube integration; absent means module + oEmbed only. */
  youtube?: YoutubeTranscriptEngine;
}

function statusFor(kind: TranscriptFailureKind): TranscriptStatus {
  switch (kind) {
    case "no-captions":
      return "no-captions";
    case "disabled":
      return "disabled";
    case "unavailable":
      return "unavailable";
    default:
      return "blocked";
  }
}

/**
 * Explicit evidence from the built-in module's typed errors. Its generic
 * "no transcripts" error is NOT proof of absent captions (it mislabels the bot
 * wall), so only disabled/unavailable are trusted here.
 */
function explicitModuleStatus(error: unknown): TranscriptStatus | null {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "YoutubeTranscriptDisabledError") return "disabled";
  if (name === "YoutubeTranscriptVideoUnavailableError") return "unavailable";
  return null;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function rethrowAbort(error: unknown, signal?: AbortSignal): void {
  if (isAbort(error) || signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

/** Extract a YouTube video's captions as a transcript-tier markdown source. */
export async function extractYoutube(url: string, options: YoutubeExtractOptions = {}): Promise<Extracted> {
  options.signal?.throwIfAborted();
  const videoId = youtubeVideoId(url);
  if (videoId === null) throw new UnsupportedInputError("youtube", `Not a recognized YouTube URL: ${url}`);
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Rung 1: the existing module. A throw or an empty result escalates.
  let segments: EngineSegment[] | null = null;
  let title: string | null = null;
  let author: string | null = null;
  let explicitStatus: TranscriptStatus | null = null;
  try {
    const result = await fetchTranscript(videoId, { videoDetails: true, signal: options.signal });
    const details: VideoDetails | undefined = result.videoDetails;
    const cleaned = result.segments
      .map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, " ").trim() }))
      .filter((segment) => segment.text !== "");
    // Blank/cleaned-empty captions are not a usable transcript: escalate.
    if (cleaned.length > 0) {
      segments = result.segments.map((segment) => ({ ...segment }));
      title = firstNonEmpty(details?.title);
      author = firstNonEmpty(details?.author);
    }
  } catch (error) {
    if (isAbort(error) || options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    explicitStatus = explicitModuleStatus(error);
  }

  // Rungs 2 and 3: anonymous yt-dlp, then signed-in when credentials exist.
  let transcriptStatus: TranscriptStatus | null = null;
  if (segments === null) {
    const engine = options.youtube;
    let attempt: TranscriptAttempt | null = null;
    if (engine !== undefined) {
      attempt = await engine.transcript(videoId, { signal: options.signal, mode: "anonymous" }).catch((error) => {
        rethrowAbort(error, options.signal);
        return null;
      });
      const escalatedKind = attempt?.ok === false ? attempt.kind : "blocked";
      const worthSigningIn =
        attempt !== null &&
        attempt.ok === false &&
        engine.hasCredentials() &&
        escalatedKind !== "engine-missing" &&
        escalatedKind !== "no-captions" &&
        escalatedKind !== "disabled" &&
        escalatedKind !== "unavailable";
      if (worthSigningIn) {
        const signed = await engine
          .transcript(videoId, { signal: options.signal, mode: "signed-in" })
          .catch((error) => {
            rethrowAbort(error, options.signal);
            return null;
          });
        if (signed !== null) attempt = signed;
      }
    }
    if (attempt?.ok === true) {
      segments = attempt.segments;
      title = title ?? firstNonEmpty(attempt.title);
      author = author ?? firstNonEmpty(attempt.author);
    } else {
      const kind: TranscriptFailureKind = attempt?.ok === false ? attempt.kind : "engine-missing";
      const fromAttempt = statusFor(kind);
      // Explicit engine evidence wins; otherwise keep an explicit module
      // verdict rather than letting an ambiguous failure overwrite it.
      const explicitEngine = kind === "no-captions" || kind === "disabled" || kind === "unavailable";
      transcriptStatus = explicitEngine ? fromAttempt : (explicitStatus ?? fromAttempt);
    }
  }
  if (segments === null && explicitStatus !== null && transcriptStatus === null) transcriptStatus = explicitStatus;

  // Honest metadata (oEmbed + thumbnail) fills gaps and backs embed-only sources.
  const needsMetadata = title === null || author === null || segments === null;
  const metadata = needsMetadata
    ? await metadataFor(videoId, options).catch((error) => {
        rethrowAbort(error, options.signal);
        return { title: null, author: null, thumbnail: null };
      })
    : { title: null, author: null, thumbnail: null as Uint8Array | null };
  title = title ?? metadata.title;
  author = author ?? metadata.author;
  let thumb: Uint8Array | undefined = metadata.thumbnail ?? undefined;
  if (thumb === undefined && segments !== null) thumb = (await thumbnailFor(videoId, options.signal)) ?? undefined;
  options.signal?.throwIfAborted();

  if (segments !== null && segments.length > 0) {
    const body = transcriptToMarkdown(segments);
    const markdown = cleanMarkdown(title === null ? body : `# ${title}\n\n${body}`);
    return {
      title,
      authors: authorsOf(author),
      markdown,
      pages: null,
      parseTier: "transcript",
      warning: null,
      transcriptStatus: null,
      url: canonicalUrl,
      originalExt: null,
      ...(thumb === undefined ? {} : { thumb }),
    };
  }

  const status: TranscriptStatus = transcriptStatus ?? "blocked";
  return {
    ...(thumb === undefined ? {} : { thumb }),
    title,
    authors: authorsOf(author),
    // No parsed prose: agents must treat an untranscribed video as unreadable.
    markdown: "",
    pages: null,
    parseTier: "basic",
    warning: TRANSCRIPT_WARNINGS[status] ?? "Transcript unavailable",
    transcriptStatus: status,
    unreadable: true,
    url: canonicalUrl,
    originalExt: null,
  };
}

async function metadataFor(
  videoId: string,
  options: YoutubeExtractOptions,
): Promise<{ title: string | null; author: string | null; thumbnail: Uint8Array | null }> {
  const engine = options.youtube;
  if (engine !== undefined) {
    const metadata = await engine.metadata(videoId, options.signal ? { signal: options.signal } : {});
    if (metadata.title !== null || metadata.author !== null || metadata.thumbnail !== null) return metadata;
  }
  return inlineMetadata(videoId, options.signal);
}

/** oEmbed title/author (hardcoded YouTube host); never invents a value. */
async function inlineMetadata(
  videoId: string,
  signal?: AbortSignal,
): Promise<{ title: string | null; author: string | null; thumbnail: Uint8Array | null }> {
  let title: string | null = null;
  let author: string | null = null;
  try {
    const response = await safeFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      {
        httpsOnly: true,
        allowedHosts: [...YOUTUBE_MEDIA_HOSTS],
        maxBytes: 512 * 1024,
        ...(signal ? { signal } : {}),
      },
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { title?: unknown; author_name?: unknown };
      title = firstNonEmpty(typeof record.title === "string" ? record.title : null);
      author = firstNonEmpty(typeof record.author_name === "string" ? record.author_name : null);
    }
  } catch (error) {
    rethrowAbort(error, signal);
    /* Metadata is best-effort. */
  }
  return { title, author, thumbnail: await thumbnailFor(videoId, signal) };
}

/** hqdefault.jpg, validated as JPEG by magic bytes; a failure is never fatal. */
async function thumbnailFor(videoId: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  try {
    const response = await safeFetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {
      maxBytes: 5 * 1024 * 1024,
      httpsOnly: true,
      allowedHosts: [...YOUTUBE_MEDIA_HOSTS],
      ...(signal ? { signal } : {}),
    });
    if (response.contentType?.split(";")[0] === "image/jpeg" && response.bytes[0] === 255 && response.bytes[1] === 216)
      return response.bytes;
  } catch (error) {
    rethrowAbort(error, signal);
    /* A thumbnail failure must not discard a usable transcript. */
  }
  return null;
}

export function transcriptToMarkdown(segments: (TranscriptSegment | EngineSegment)[]): string {
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
