// The chat dock for one study set: state from `useChatDock` plus the desktop dock or the mobile
// sheet. A separate module so the whole chat UI (and its markdown renderer) is fetched only when a
// set screen is opened, not on the landing page (see ChatDock.tsx).
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import DesktopChatDock from "./DesktopChatDock";
import MobileChatDock from "./MobileChatDock";
import { useChatDock } from "./useChatDock";

const DESKTOP_QUERY = "(min-width: 1024px)";

export default function ChatDockWithSet({ set }: { set: string }) {
  const chat = useChatDock(set);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  return (
    <TooltipProvider>{isDesktop ? <DesktopChatDock chat={chat} /> : <MobileChatDock chat={chat} />}</TooltipProvider>
  );
}
