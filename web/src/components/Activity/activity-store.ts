import { useSyncExternalStore } from "react";

// A2/A4: the activity panel's open state lives in a tiny module store rather than React
// context because toast content (react-hot-toast renders outside the router tree) and
// list placeholders both need to open the panel without prop drilling.
export interface ActivityPanelState {
  open: boolean;
  /** A specific job to highlight, e.g. the one a "Details" toast points at. */
  jobId?: string;
}

let state: ActivityPanelState = { open: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openActivityPanel(jobId?: string): void {
  state = { open: true, ...(jobId ? { jobId } : {}) };
  emit();
}

export function closeActivityPanel(): void {
  if (!state.open) return;
  state = { open: false };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActivityPanelState(): ActivityPanelState {
  return useSyncExternalStore(subscribe, () => state);
}
