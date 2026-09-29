// A tiny window-level signal so pages outside the dock (e.g. SetHomePage's "Ask tutor"
// button) can open it without lifting its open/collapsed state out of MobileChatDock /
// DesktopChatDock — both already own that state locally and just listen for this event.
export const OPEN_CHAT_DOCK_EVENT = "studium:open-chat-dock";

export function openChatDock(): void {
  window.dispatchEvent(new Event(OPEN_CHAT_DOCK_EVENT));
}
