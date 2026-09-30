// B3: remember the reader's scroll position per note for this tab session, so leaving a
// note and coming back lands where reading stopped. sessionStorage (per tab, survives
// reloads, dies with the tab); all access is guarded — a storage failure just means no
// restore.
const PREFIX = "studium.note-scroll:";

function key(set: string, path: string): string {
  return `${PREFIX}${set}/${path}`;
}

export function readScrollPosition(set: string, path: string): number | null {
  try {
    const raw = sessionStorage.getItem(key(set, path));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveScrollPosition(set: string, path: string, y: number): void {
  if (!Number.isFinite(y) || y < 0) return;
  try {
    sessionStorage.setItem(key(set, path), String(Math.floor(y)));
  } catch {
    // Storage unavailable (private mode, quota): no restore for this session.
  }
}
