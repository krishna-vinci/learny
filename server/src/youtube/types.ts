import type { YoutubeIntegrationStatus } from "@studium/shared";

export type { YoutubeIntegrationStatus };

/** A caption segment normalized to the extractor's existing shape (seconds). */
export interface EngineSegment {
  text: string;
  offset: number;
  duration: number;
  lang?: string;
}

/**
 * Internal failure taxonomy for the retrieval ladder. The extractor maps these
 * onto the owner's plain-language copy; nothing here is shown to a user.
 */
export type TranscriptFailureKind =
  | "engine-missing"
  | "blocked"
  | "no-captions"
  | "disabled"
  | "unavailable"
  | "stale-cookie"
  | "extraction-error";

export interface TranscriptSuccess {
  ok: true;
  segments: EngineSegment[];
  /** yt-dlp's recovered title/author when the module could not read the page. */
  title?: string;
  author?: string;
}

export interface TranscriptFailure {
  ok: false;
  kind: TranscriptFailureKind;
  /** True when the same request may succeed later or after setup. */
  retryable: boolean;
}

export type TranscriptAttempt = TranscriptSuccess | TranscriptFailure;

export type EngineRunMode = "anonymous" | "signed-in";

export interface EngineRunOptions {
  signal?: AbortSignal;
  mode?: EngineRunMode;
}

export interface YoutubeMetadata {
  title: string | null;
  author: string | null;
  thumbnail: Uint8Array | null;
}

/**
 * The slice of the integration service `extractYoutube` consumes. Kept as an
 * interface so unit tests can inject a fake without touching yt-dlp, files or
 * the network.
 */
export interface YoutubeTranscriptEngine {
  /** Whether an operator-supplied cookie jar is configured (env or uploaded). */
  hasCredentials(): boolean;
  /** Run yt-dlp (anonymous or signed-in) and normalize one English track. */
  transcript(videoId: string, options?: EngineRunOptions): Promise<TranscriptAttempt>;
  /** oEmbed/thumbnail metadata; never invents a title or author. */
  metadata(videoId: string, options?: { signal?: AbortSignal }): Promise<YoutubeMetadata>;
}
