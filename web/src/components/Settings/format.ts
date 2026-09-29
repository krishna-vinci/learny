// Small formatting helpers shared by the account/session/token/member tables.
const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "3 days ago" / "in 5 days", or "just now" for anything under a minute. */
export function relativeTime(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  for (const [unit, unitSeconds] of UNITS) {
    if (abs >= unitSeconds) return RTF.format(Math.round(seconds / unitSeconds), unit);
  }
  return seconds < 0 ? "just now" : RTF.format(Math.round(seconds), "second");
}
