// A calm, persistent notice while the browser is offline: reading recent notes still works, saving does not.
import { WifiOffIcon } from "lucide-react";
import { useOffline } from "@/lib/offline";

export function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-ink"
    >
      <WifiOffIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        You're offline. You can still read what you opened recently. Changes can't be saved until you're back online.
      </span>
    </div>
  );
}
