// Not a Memos port (Memos keeps a 15-minute access JWT in memory and has no session
// list); Studium's DB-backed sessions (docs/plans/2026-09-29-m3a-platform.md, Global
// constraints) are listable and revocable.
import { LaptopIcon } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { useRevokeSession, useSessions } from "@/api/queries";
import ConfirmDialog from "@/components/ConfirmDialog";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/notify";
import { relativeTime } from "./format";
import SettingSection from "./SettingSection";

const SessionsSection = () => {
  const { data, isLoading } = useSessions();
  const revoke = useRevokeSession();
  const [target, setTarget] = useState<string | null>(null);
  const sessions = data?.sessions ?? [];

  async function handleRevoke() {
    if (!target) return;
    try {
      await revoke.mutateAsync(target);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke session.");
    }
  }

  return (
    <SettingSection title="Sessions" description="Devices and browsers currently signed in to your account.">
      {isLoading ? (
        <RowsSkeleton rows={2} />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3">
              <LaptopIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
                  <span className="max-w-[16rem] truncate">{session.userAgent || "Unknown device"}</span>
                  {session.current && (
                    <Badge variant="accent" caps>
                      This device
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {session.ip} · last active {relativeTime(session.lastUsedAt)}
                </div>
              </div>
              {!session.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 shrink-0 sm:h-7"
                  onClick={() => setTarget(session.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Revoke this session?"
        description="The device will be signed out immediately."
        confirmLabel="Revoke"
        confirmVariant="destructive"
        onConfirm={handleRevoke}
      />
    </SettingSection>
  );
};

export default SessionsSection;
