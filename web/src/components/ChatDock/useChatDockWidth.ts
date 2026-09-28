import { usePersistedWidth } from "@/components/AppSidebar";

export const CHAT_DOCK_WIDTH_VAR = "--chat-dock-width";
export const CHAT_DOCK_MIN_WIDTH = 288;
export const CHAT_DOCK_MAX_WIDTH = 480;
export const CHAT_DOCK_DEFAULT_WIDTH = 340;

const MAX_VIEWPORT_SHARE = 0.4;

/** Persisted width for the chat dock, reusing the sidebar's resizable-rail primitive. */
const useChatDockWidth = () =>
  usePersistedWidth({
    storageKey: "studium-chat-dock-width",
    defaultWidth: CHAT_DOCK_DEFAULT_WIDTH,
    minWidth: CHAT_DOCK_MIN_WIDTH,
    maxWidthFor: (viewportWidth) => Math.min(CHAT_DOCK_MAX_WIDTH, viewportWidth * MAX_VIEWPORT_SHARE),
  });

export default useChatDockWidth;
