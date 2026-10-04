import type { EngineSegment } from "./types.js";

/** Non-speech markers YouTube inserts into auto captions. */
const NON_SPEECH_MARKER =
  /\[\s*(?:music|applause|laughter|silence|inaudible|sighs?|cheering|background noise|foreign|sound effect[s]?)\s*\]/gi;
/** Whole-line translator/caption credit lines (never real prose). */
const CREDIT_LINE =
  /^\s*(?:(?:subtitles?|captions?)\s*(?:by\b|:)|transcri(?:bed|ption)\s+by\b|sync(?:hronized)?\s+by\b|translat(?:ed|ion)\s+by\b|translator\s*:|review(?:ed|er)\s*(?:by\b|:)|amara\.org\b|www\.amara\.org\b|otter\.ai\b|rev\.com\b)/i;

/**
 * Conservative cleaning pass for caption text: drop standalone music markers
 * and translator credit lines without touching ordinary sentences.
 */
export function cleanTranscriptText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !CREDIT_LINE.test(line))
    .join(" ")
    .replace(NON_SPEECH_MARKER, " ")
    .replace(/♪/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

interface Json3Event {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: unknown;
}

function eventText(segs: unknown): string {
  if (!Array.isArray(segs)) return "";
  let out = "";
  for (const seg of segs) {
    if (typeof seg !== "object" || seg === null) continue;
    const utf8 = (seg as { utf8?: unknown }).utf8;
    if (typeof utf8 === "string") out += utf8;
  }
  return out;
}

/**
 * Map a yt-dlp `json3` subtitle document onto the extractor's segment shape:
 * `offset` and `duration` in seconds, joined multi-part events flattened.
 */
export function parseJson3(payload: string): EngineSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  const segments: EngineSegment[] = [];
  for (const raw of events) {
    if (typeof raw !== "object" || raw === null) continue;
    const event = raw as Json3Event;
    if (typeof event.tStartMs !== "number" || !Number.isFinite(event.tStartMs)) continue;
    const text = cleanTranscriptText(eventText(event.segs));
    if (text === "") continue;
    // Keep fractional seconds; `transcriptToMarkdown` floors only the marker.
    const offset = Math.max(0, Math.round((event.tStartMs / 1000) * 1000) / 1000);
    const duration =
      typeof event.dDurationMs === "number" && Number.isFinite(event.dDurationMs)
        ? Math.max(0, event.dDurationMs / 1000)
        : 0;
    // Auto captions repeat the same line across adjacent events; keep the first.
    if (segments.length > 0 && segments[segments.length - 1]?.text === text) continue;
    segments.push({ text, offset, duration });
  }
  return segments;
}
