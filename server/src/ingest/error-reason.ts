/** Persist a bounded reason without URL credentials, query secrets or bearer/API tokens. */
export function publicErrorReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text
      .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
        try {
          const url = new URL(raw);
          return `${url.protocol}//${url.hostname}${url.pathname}`;
        } catch {
          return "[URL]";
        }
      })
      .replace(/\b(?:Bearer\s+|(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)\S+/gi, "[redacted]")
      .replace(/\b(?:sk-|studium_pat_)[\w-]+/g, "[redacted]")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: persisted reasons must remove control characters.
      .replace(/[\r\n\x00-\x1f]+| · /g, " ")
      .slice(0, 240)
  );
}
