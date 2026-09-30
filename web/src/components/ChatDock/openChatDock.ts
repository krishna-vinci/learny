// Retain a request across navigation so a dock mounted for a search result can consume it.
export const OPEN_CHAT_DOCK_EVENT = "studium:open-chat-dock";
export interface ChatDockRequest {
  set: string;
  chatId?: string;
  text?: string;
  anchor?: string;
  quote?: string;
}
let pending: ChatDockRequest | null = null;
export function takeChatDockRequest(set: string): ChatDockRequest | null {
  if (pending?.set !== set) return null;
  const request = pending;
  pending = null;
  return request;
}
export function openChatDock(request?: ChatDockRequest): void {
  if (request) pending = request;
  window.dispatchEvent(new Event(OPEN_CHAT_DOCK_EVENT));
}
