// Not a Memos port (Memos' NotificationSection is instance-wide webhook config; Studium's
// is per-user ntfy + Web Push, per docs/plans/2026-09-29-m3a-platform.md T5). Targets
// `/api/me/notifications` (server/src/notify/routes.ts).
import { BellRingIcon, SmartphoneIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { ApiError } from "@/api/client";
import {
  useDeletePush,
  useNotifications,
  usePatchNotificationEvents,
  useSubscribePush,
  useTestNotification,
  useUpdateNtfy,
} from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { subscribeToPush } from "@/lib/push";
import { relativeTime } from "./format";
import SettingGroup from "./SettingGroup";
import SettingRow from "./SettingRow";
import SettingSection from "./SettingSection";

const NotificationsSection = () => {
  const { data, isLoading } = useNotifications();
  const updateNtfy = useUpdateNtfy();
  const patchEvents = usePatchNotificationEvents();
  const subscribePush = useSubscribePush();
  const deletePush = useDeletePush();
  const testNotification = useTestNotification();

  const [ntfyUrl, setNtfyUrl] = useState("");
  const [ntfyToken, setNtfyToken] = useState("");
  const [ntfyDirty, setNtfyDirty] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    if (data && !ntfyDirty) setNtfyUrl(data.ntfy.url);
  }, [data, ntfyDirty]);

  async function saveNtfy() {
    try {
      await updateNtfy.mutateAsync({ url: ntfyUrl, ...(ntfyToken ? { token: ntfyToken } : {}) });
      setNtfyDirty(false);
      setNtfyToken("");
      toast.success("ntfy settings saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save ntfy settings.");
    }
  }

  async function handleSubscribe() {
    if (!data) return;
    setSubscribing(true);
    try {
      const subscription = await subscribeToPush(data.vapidPublicKey);
      await subscribePush.mutateAsync(subscription);
      toast.success("Push notifications enabled on this device");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enable push notifications.");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleTest() {
    try {
      await testNotification.mutateAsync();
      toast.success("Test notification sent");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send test notification.");
    }
  }

  if (isLoading || !data) {
    return (
      <SettingSection title="Notifications">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </SettingSection>
    );
  }

  return (
    <SettingSection
      title="Notifications"
      description="Get notified when a job finishes or fails."
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-11 sm:h-7"
          onClick={() => void handleTest()}
          disabled={testNotification.isPending}
        >
          <BellRingIcon className="size-3.5" aria-hidden="true" />
          Send test
        </Button>
      }
    >
      <SettingGroup title="ntfy" description="Push via a ntfy.sh topic or a self-hosted ntfy server.">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="ntfy-url">Topic URL</Label>
            <Input
              id="ntfy-url"
              className="mt-1.5 h-11 sm:h-8"
              value={ntfyUrl}
              onChange={(e) => {
                setNtfyUrl(e.target.value);
                setNtfyDirty(true);
              }}
              placeholder="https://ntfy.sh/your-topic"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="ntfy-token">Access token {data.ntfy.hasToken && "(set)"}</Label>
            <Input
              id="ntfy-token"
              type="password"
              className="mt-1.5 h-11 sm:h-8"
              value={ntfyToken}
              onChange={(e) => {
                setNtfyToken(e.target.value);
                setNtfyDirty(true);
              }}
              placeholder={data.ntfy.hasToken ? "Leave blank to keep it" : "Optional"}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button className="h-11 sm:h-8" disabled={!ntfyDirty || updateNtfy.isPending} onClick={() => void saveNtfy()}>
            {updateNtfy.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup
        showSeparator
        title="Web Push"
        description="Notifications on this device, even when the tab is closed."
      >
        <Button
          variant="outline"
          className="h-11 w-full justify-start sm:w-auto sm:h-8"
          onClick={() => void handleSubscribe()}
          disabled={subscribing}
        >
          <SmartphoneIcon className="size-4" aria-hidden="true" />
          {subscribing ? "Enabling…" : "Enable push on this device"}
        </Button>
        {data.subscriptions.length > 0 && (
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
            {data.subscriptions.map((sub) => (
              <li key={sub.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{sub.userAgent || "Unknown device"}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">Added {relativeTime(sub.createdAt)}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-destructive sm:size-7"
                  aria-label="Remove"
                  onClick={() => void deletePush.mutateAsync(sub.id)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>

      <SettingGroup showSeparator title="Events">
        <SettingRow label="Job finished" vertical={false}>
          <Switch
            checked={data.events.jobDone}
            onCheckedChange={(checked) => void patchEvents.mutateAsync({ jobDone: checked })}
          />
        </SettingRow>
        <SettingRow label="Job failed">
          <Switch
            checked={data.events.jobFailed}
            onCheckedChange={(checked) => void patchEvents.mutateAsync({ jobFailed: checked })}
          />
        </SettingRow>
      </SettingGroup>
    </SettingSection>
  );
};

export default NotificationsSection;
