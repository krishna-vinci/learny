// B2: full-screen reading. The active flag lives in a module store (like the activity
// panel's) because the pieces that react to it are spread across the app shell —
// RootLayout hides the sidebar/chat/mobile header, the Reader shows the floating Exit
// button. `enterImmersive`/`exitImmersive` also drive the Fullscreen API where it
// exists (desktop, Android); iOS Safari has no element fullscreen on iPhone, so there
// the flag alone produces the CSS-only immersive mode. `useImmersiveEffects` — mounted
// once in RootLayout — keeps the flag in sync when the browser exits fullscreen itself
// (Esc, F11) and holds a screen wake lock while immersive, released on exit or when
// the tab is hidden.
import { useEffect, useSyncExternalStore } from "react";

interface ImmersiveState {
  active: boolean;
}

let state: ImmersiveState = { active: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useImmersive(): boolean {
  return useSyncExternalStore(subscribe, () => state.active);
}

export function isImmersive(): boolean {
  return state.active;
}

export function enterImmersive(): void {
  if (state.active) return;
  state = { active: true };
  emit();
  // Best-effort: iOS Safari on iPhone has no `requestFullscreen`, and some browsers
  // reject it — either way the CSS-only immersive mode still applies via the flag.
  try {
    void document.documentElement.requestFullscreen?.()?.catch(() => undefined);
  } catch {
    // Non-throwing by design; the flag is the source of truth.
  }
}

export function exitImmersive(): void {
  if (!state.active) return;
  state = { active: false };
  emit();
  try {
    // Only when we own the native mode, so the browser's own exit doesn't loop back here.
    if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => undefined);
  } catch {
    // Ignore: the flag is already back to normal.
  }
}

export function toggleImmersive(): void {
  if (state.active) exitImmersive();
  else enterImmersive();
}

/** Minimal shape of the Wake Lock API (not in every browser; typed locally, no new deps). */
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};

/** Mount once (RootLayout): fullscreenchange sync + the screen wake lock lifecycle. */
export function useImmersiveEffects(): void {
  const active = useImmersive();

  // If the browser left fullscreen on its own (Esc, F11), drop the immersive flag too.
  useEffect(() => {
    if (!active) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) exitImmersive();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinelLike | null = null;

    const release = () => {
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
    const acquire = () => {
      release();
      const lock = (navigator as NavigatorWithWakeLock).wakeLock;
      lock
        ?.request("screen")
        .then((value) => {
          sentinel = value;
        })
        .catch(() => undefined); // Unsupported or denied: reading still works.
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") release();
      else acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      release();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);
}
