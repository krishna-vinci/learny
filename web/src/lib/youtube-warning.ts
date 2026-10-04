/**
 * Member-aware copy for an embed-only YouTube source. Admins get the Settings
 * path; members are told to ask their admin. Falls back to the stored warning.
 */
export function youtubeTranscriptWarning(
  status: string | null | undefined,
  isAdmin: boolean,
  fallback?: string | null,
): string | null {
  switch (status) {
    case "no-captions":
      return "This video has no captions";
    case "disabled":
      return "Captions are turned off by the uploader";
    case "blocked":
      return isAdmin
        ? "YouTube blocked the transcript for this video — try again later, or set up YouTube sign-in in Settings"
        : "YouTube blocked the transcript for this video — try again later, or ask your admin";
    case "unavailable":
      return isAdmin
        ? "YouTube couldn't provide the transcript for this video — try again later, or set up YouTube sign-in in Settings"
        : "YouTube couldn't provide the transcript for this video — try again later, or ask your admin";
    default:
      return fallback ?? null;
  }
}

/** True when the Retry transcript action is offered for this source. */
export function isRetryableTranscript(status: string | null | undefined): boolean {
  return status === "blocked" || status === "unavailable";
}
