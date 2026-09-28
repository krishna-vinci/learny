import { useCallback, useState } from "react";

const STORAGE_KEY = "studium-chat-dock-collapsed";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persisted collapse state for the chat dock, mirroring the sidebar's width persistence. */
export function useChatDockCollapsed() {
  const [collapsed, setCollapsedState] = useState(readStored);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage failures (private browsing, quota, etc.).
    }
  }, []);

  return { collapsed, setCollapsed };
}
