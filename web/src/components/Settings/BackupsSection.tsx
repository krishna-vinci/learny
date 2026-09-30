// Admin "Backups" section — restic-backed wizard + status panel, per
// docs/plans/2026-09-29-m3a-platform.md T4/T6 and server/src/backups/routes.ts. Not a
// Memos port (Memos has no backup feature).

import { useEffect, useRef, useState } from "react";
import type { BackupDestination, ProbeResult, SnapshotInfo } from "@/api/client";
import { ApiError } from "@/api/client";
import {
  useAdminBackups,
  useAdminUsers,
  useBackupSnapshots,
  useBackupStatus,
  useCheckBackup,
  useInitBackup,
  useRestoreBackup,
  useRunBackup,
  useSftpKey,
  useTestBackupDestination,
  useUpdateBackupSettings,
} from "@/api/queries";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/notify";
import { relativeTime } from "./format";
import SettingGroup from "./SettingGroup";
import SettingRow from "./SettingRow";
import SettingSection from "./SettingSection";

type DestType = BackupDestination["type"];

const DEST_TYPES: { type: DestType; label: string; description: string }[] = [
  { type: "local", label: "Local folder", description: "An absolute path on this server." },
  { type: "sftp", label: "SFTP", description: "Push over SSH to a remote host." },
  { type: "rest", label: "REST server", description: "A restic rest-server URL." },
  { type: "s3", label: "S3-compatible", description: "AWS S3 or a compatible bucket." },
  { type: "rclone", label: "rclone", description: "Any rclone remote, via a pasted config." },
];

function emptyDestination(type: DestType): BackupDestination {
  switch (type) {
    case "local":
      return { type: "local", path: "" };
    case "sftp":
      return { type: "sftp", host: "", port: 22, user: "", path: "" };
    case "rest":
      return { type: "rest", url: "", username: "", password: "" };
    case "s3":
      return { type: "s3", endpoint: "", bucket: "", prefix: "", accessKeyId: "", secretAccessKey: "", region: "" };
    case "rclone":
      return { type: "rclone", remote: "", path: "", rcloneConfig: "" };
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// --- Destination form -----------------------------------------------------------------

function DestinationForm({
  destination,
  onChange,
}: {
  destination: BackupDestination;
  onChange: (destination: BackupDestination) => void;
}) {
  const sftpKey = useSftpKey();
  const [publicKey, setPublicKey] = useState<string | null>(null);

  if (destination.type === "local") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="backup-local-path">Absolute path</Label>
        <Input
          id="backup-local-path"
          value={destination.path}
          onChange={(e) => onChange({ ...destination, path: e.target.value })}
          placeholder="/mnt/backups/studium"
        />
      </div>
    );
  }
  if (destination.type === "sftp") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-sftp-host">Host</Label>
            <Input
              id="backup-sftp-host"
              value={destination.host}
              onChange={(e) => onChange({ ...destination, host: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-sftp-port">Port</Label>
            <Input
              id="backup-sftp-port"
              type="number"
              value={destination.port}
              onChange={(e) => onChange({ ...destination, port: Number(e.target.value) || 22 })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-sftp-user">User</Label>
            <Input
              id="backup-sftp-user"
              value={destination.user}
              onChange={(e) => onChange({ ...destination, user: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-sftp-path">Remote path</Label>
            <Input
              id="backup-sftp-path"
              value={destination.path}
              onChange={(e) => onChange({ ...destination, path: e.target.value })}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto sm:h-8"
          disabled={sftpKey.isPending}
          onClick={async () => {
            try {
              const result = await sftpKey.mutateAsync();
              setPublicKey(result.publicKey);
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Failed to generate the SFTP key.");
            }
          }}
        >
          {sftpKey.isPending ? "Generating…" : publicKey ? "Regenerate key" : "Generate SSH key"}
        </Button>
        {publicKey && (
          <div className="flex flex-col gap-1.5">
            <Label>Public key</Label>
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 break-all text-xs">{publicKey}</code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 sm:size-8"
                onClick={async () => {
                  const ok = await copyToClipboard(publicKey);
                  toast[ok ? "success" : "error"](ok ? "Copied" : "Couldn't copy.");
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this to <code>~/.ssh/authorized_keys</code> on the server.
            </p>
          </div>
        )}
      </div>
    );
  }
  if (destination.type === "rest") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-rest-url">Server URL</Label>
          <Input
            id="backup-rest-url"
            value={destination.url}
            onChange={(e) => onChange({ ...destination, url: e.target.value })}
            placeholder="https://192.168.0.55:8000/studium"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-rest-username">Username (optional)</Label>
            <Input
              id="backup-rest-username"
              value={destination.username ?? ""}
              onChange={(e) => onChange({ ...destination, username: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backup-rest-password">Password (optional)</Label>
            <Input
              id="backup-rest-password"
              type="password"
              value={destination.password ?? ""}
              onChange={(e) => onChange({ ...destination, password: e.target.value })}
            />
          </div>
        </div>
      </div>
    );
  }
  if (destination.type === "s3") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-s3-endpoint">Endpoint</Label>
          <Input
            id="backup-s3-endpoint"
            value={destination.endpoint}
            onChange={(e) => onChange({ ...destination, endpoint: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-s3-bucket">Bucket</Label>
          <Input
            id="backup-s3-bucket"
            value={destination.bucket}
            onChange={(e) => onChange({ ...destination, bucket: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-s3-prefix">Prefix</Label>
          <Input
            id="backup-s3-prefix"
            value={destination.prefix}
            onChange={(e) => onChange({ ...destination, prefix: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-s3-region">Region (optional)</Label>
          <Input
            id="backup-s3-region"
            value={destination.region ?? ""}
            onChange={(e) => onChange({ ...destination, region: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-s3-key">Access key ID</Label>
          <Input
            id="backup-s3-key"
            value={destination.accessKeyId}
            onChange={(e) => onChange({ ...destination, accessKeyId: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-s3-secret">Secret access key</Label>
          <Input
            id="backup-s3-secret"
            type="password"
            value={destination.secretAccessKey}
            onChange={(e) => onChange({ ...destination, secretAccessKey: e.target.value })}
          />
        </div>
      </div>
    );
  }
  // rclone
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-rclone-remote">Remote name</Label>
          <Input
            id="backup-rclone-remote"
            value={destination.remote}
            onChange={(e) => onChange({ ...destination, remote: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="backup-rclone-path">Path</Label>
          <Input
            id="backup-rclone-path"
            value={destination.path}
            onChange={(e) => onChange({ ...destination, path: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="backup-rclone-config">rclone.conf section</Label>
        <textarea
          id="backup-rclone-config"
          className="min-h-32 w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs"
          value={destination.rcloneConfig}
          onChange={(e) => onChange({ ...destination, rcloneConfig: e.target.value })}
          placeholder={"[myremote]\ntype = ...\n..."}
        />
      </div>
    </div>
  );
}

// --- Wizard -----------------------------------------------------------------------------

function BackupWizard({ onConfigured }: { onConfigured: () => void }) {
  const [type, setType] = useState<DestType | null>(null);
  const [destination, setDestination] = useState<BackupDestination | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [existingPassword, setExistingPassword] = useState("");
  const [recoveryKit, setRecoveryKit] = useState<{
    repository: string;
    password: string;
    restoreSteps: string[];
  } | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);
  const test = useTestBackupDestination();
  const init = useInitBackup();

  function selectType(next: DestType) {
    setType(next);
    setDestination(emptyDestination(next));
    setProbe(null);
  }

  async function handleTest() {
    if (!destination) return;
    try {
      const result = await test.mutateAsync(destination);
      setProbe(result);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to test the destination.");
    }
  }

  async function handleInit() {
    if (!destination) return;
    try {
      const { recoveryKit: kit } = await init.mutateAsync({
        destination,
        ...(probe?.state === "existing" ? { existingPassword } : {}),
      });
      setRecoveryKit(kit);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to set up the backup repository.");
    }
  }

  function downloadRecoveryKit() {
    if (!recoveryKit) return;
    const text = [
      "Studium backup recovery kit",
      "",
      `Repository: ${recoveryKit.repository}`,
      `Password: ${recoveryKit.password}`,
      "",
      "Restore steps:",
      ...recoveryKit.restoreSteps.map((step, i) => `${i + 1}. ${step}`),
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "studium-backup-recovery-kit.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (recoveryKit) {
    return (
      <SettingGroup title="Recovery kit" description="This password is shown once. Save it now.">
        <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <div>
            <span className="font-medium">Repository:</span> <code className="break-all">{recoveryKit.repository}</code>
          </div>
          <div>
            <span className="font-medium">Password:</span> <code className="break-all">{recoveryKit.password}</code>
          </div>
          <ol className="ms-4 list-decimal space-y-1">
            {recoveryKit.restoreSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <Button variant="outline" className="h-11 w-full sm:w-auto sm:h-8" onClick={downloadRecoveryKit}>
          Download as .txt
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={savedChecked}
            onChange={(e) => setSavedChecked(e.target.checked)}
            className="size-4"
          />
          I saved this password somewhere safe
        </label>
        <Button className="h-11 sm:h-8" disabled={!savedChecked} onClick={onConfigured}>
          Continue
        </Button>
      </SettingGroup>
    );
  }

  return (
    <SettingGroup title="Set up backups" description="Choose where restic will store encrypted backups.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DEST_TYPES.map((d) => (
          <button
            key={d.type}
            type="button"
            className={`flex h-20 flex-col justify-center gap-1 rounded-md border px-2 text-start text-sm transition-colors ${
              type === d.type ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-accent/60"
            }`}
            onClick={() => selectType(d.type)}
          >
            <span className="font-medium">{d.label}</span>
            <span className="text-xs text-muted-foreground">{d.description}</span>
          </button>
        ))}
      </div>

      {destination && (
        <>
          <DestinationForm destination={destination} onChange={setDestination} />
          <Button
            variant="outline"
            className="h-11 w-full sm:w-auto sm:h-8"
            onClick={() => void handleTest()}
            disabled={test.isPending}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          {probe && (
            <div
              className={`rounded-md border p-3 text-sm ${
                probe.state === "error" ? "border-destructive/40 bg-destructive/10" : "border-border bg-muted/40"
              }`}
            >
              <p className="font-medium">
                {probe.state === "empty" && "No repository here yet — Set up will create one."}
                {probe.state === "existing" && "An existing restic repository was found."}
                {probe.state === "error" && "Couldn't reach this destination."}
              </p>
              <p className="mt-1 text-muted-foreground">{probe.message}</p>
              {probe.state === "existing" && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <Label htmlFor="backup-existing-password">Repository password</Label>
                  <Input
                    id="backup-existing-password"
                    type="password"
                    value={existingPassword}
                    onChange={(e) => setExistingPassword(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}
          {probe && probe.state !== "error" && (
            <Button className="h-11 sm:h-8" onClick={() => void handleInit()} disabled={init.isPending}>
              {init.isPending ? "Setting up…" : "Set up"}
            </Button>
          )}
        </>
      )}
    </SettingGroup>
  );
}

// --- Restore dialog ----------------------------------------------------------------------

function RestoreDialog({
  snapshot,
  onOpenChange,
}: {
  snapshot: SnapshotInfo | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: usersData } = useAdminUsers();
  const restore = useRestoreBackup();
  const [username, setUsername] = useState("");
  const [scopeType, setScopeType] = useState<"set" | "note">("set");
  const [scopePath, setScopePath] = useState("");

  useEffect(() => {
    if (snapshot) {
      setUsername(usersData?.users[0]?.username ?? "");
      setScopeType("set");
      setScopePath("");
    }
  }, [snapshot, usersData]);

  async function handleRestore() {
    if (!snapshot || !username || !scopePath) return;
    try {
      const result = await restore.mutateAsync({
        snapshotId: snapshot.id,
        scope: { type: scopeType, username, path: scopePath },
      });
      toast.success(`Restored to ${result.path}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to restore.");
    }
  }

  return (
    <Dialog open={snapshot !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore from {snapshot?.shortId}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="restore-username">User</Label>
            <select
              id="restore-username"
              className="h-11 rounded-md border border-border bg-transparent px-3 text-sm sm:h-8"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            >
              {(usersData?.users ?? []).map((u) => (
                <option key={u.id} value={u.username}>
                  {u.username}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="restore-scope-type">Scope</Label>
            <select
              id="restore-scope-type"
              className="h-11 rounded-md border border-border bg-transparent px-3 text-sm sm:h-8"
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value as "set" | "note")}
            >
              <option value="set">Whole study set</option>
              <option value="note">One note</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="restore-path">Path</Label>
            <Input
              id="restore-path"
              value={scopePath}
              onChange={(e) => setScopePath(e.target.value)}
              placeholder={scopeType === "set" ? "linear-algebra" : "linear-algebra/notes/01-vectors.md"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="h-11 sm:h-8"
            onClick={() => void handleRestore()}
            disabled={restore.isPending || !username || !scopePath}
          >
            {restore.isPending ? "Restoring…" : "Restore"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Status panel ------------------------------------------------------------------------

function StatusPanel({ onChangeDestination }: { onChangeDestination: () => void }) {
  const { data, isLoading } = useAdminBackups();
  const { data: status } = useBackupStatus();
  const update = useUpdateBackupSettings();
  const run = useRunBackup();
  const check = useCheckBackup();
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const { data: snapshotsData, isLoading: snapshotsLoading } = useBackupSnapshots(snapshotsOpen);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotInfo | null>(null);

  const [time, setTime] = useState("03:30");
  const [enabled, setEnabled] = useState(false);
  const [retention, setRetention] = useState({ daily: 7, weekly: 4, monthly: 12 });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) {
      setTime(data.config.schedule.time);
      setEnabled(data.config.schedule.enabled);
      setRetention(data.config.retention);
    }
  }, [data, dirty]);

  if (isLoading || !data) return <RowsSkeleton rows={2} />;

  async function saveSchedule() {
    try {
      await update.mutateAsync({ schedule: { time, enabled }, retention });
      setDirty(false);
      toast.success("Backup settings saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save backup settings.");
    }
  }

  return (
    <>
      <SettingGroup title="Status">
        <SettingRow label="Restic version" vertical={false}>
          <span className="text-sm text-muted-foreground">{data.resticVersion}</span>
        </SettingRow>
        <SettingRow label="Destination">
          <span className="text-sm text-muted-foreground">
            {data.config.destination ? `${data.config.destination.type}` : "Not set"}
          </span>
        </SettingRow>
        <SettingRow label="Last run">
          <span className="text-sm text-muted-foreground">
            {data.config.lastRun
              ? `${data.config.lastRun.ok ? "OK" : "Failed"} · ${relativeTime(data.config.lastRun.at)}`
              : "Never"}
          </span>
        </SettingRow>
        <SettingRow label="Last check">
          <span className="text-sm text-muted-foreground">
            {data.config.lastCheck
              ? `${data.config.lastCheck.ok ? "OK" : "Failed"} · ${relativeTime(data.config.lastCheck.at)}`
              : "Never"}
          </span>
        </SettingRow>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 sm:h-8"
            disabled={run.isPending || status?.running}
            onClick={async () => {
              try {
                await run.mutateAsync();
                toast.success("Backup started");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Failed to start backup.");
              }
            }}
          >
            {status?.running ? `Running: ${status.phase ?? "…"}` : "Back up now"}
          </Button>
          <Button
            variant="outline"
            className="h-11 sm:h-8"
            disabled={check.isPending}
            onClick={async () => {
              try {
                await check.mutateAsync();
                toast.success("Check started");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Failed to run check.");
              }
            }}
          >
            {check.isPending ? "Checking…" : "Check"}
          </Button>
          <Button variant="outline" className="h-11 sm:h-8" onClick={onChangeDestination}>
            Change destination
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup showSeparator title="Schedule &amp; retention">
        <SettingRow label="Daily backup" vertical={false}>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setDirty(true);
            }}
          />
        </SettingRow>
        <SettingRow label="Time">
          <Input
            type="time"
            className="h-11 w-36 sm:h-8"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setDirty(true);
            }}
          />
        </SettingRow>
        <div className="grid grid-cols-3 gap-3">
          {(["daily", "weekly", "monthly"] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`backup-retention-${key}`} className="capitalize">
                Keep {key}
              </Label>
              <Input
                id={`backup-retention-${key}`}
                type="number"
                min={0}
                className="h-11 sm:h-8"
                value={retention[key]}
                onChange={(e) => {
                  setRetention((r) => ({ ...r, [key]: Number(e.target.value) || 0 }));
                  setDirty(true);
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button className="h-11 sm:h-8" disabled={!dirty || update.isPending} onClick={() => void saveSchedule()}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup showSeparator title="Snapshots">
        {!snapshotsOpen ? (
          <Button variant="outline" className="h-11 w-full sm:w-auto sm:h-8" onClick={() => setSnapshotsOpen(true)}>
            Show snapshots
          </Button>
        ) : snapshotsLoading ? (
          <RowsSkeleton rows={2} />
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
            {(snapshotsData?.snapshots ?? []).map((snapshot) => (
              <li key={snapshot.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-foreground">{snapshot.shortId}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {relativeTime(snapshot.time)} · {snapshot.paths.join(", ")}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-11 sm:h-7" onClick={() => setRestoreTarget(snapshot)}>
                  Restore
                </Button>
              </li>
            ))}
            {(snapshotsData?.snapshots ?? []).length === 0 && (
              <li className="px-4 py-3 text-sm text-muted-foreground">No snapshots yet.</li>
            )}
          </ul>
        )}
      </SettingGroup>

      <RestoreDialog snapshot={restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)} />
    </>
  );
}

// --- Root ---------------------------------------------------------------------------------

const BackupsSection = () => {
  const { data, isLoading } = useAdminBackups();
  // Deliberately NOT derived from `data.config.destination` on every render: `useInitBackup`
  // invalidates the backups query as soon as `POST /init` succeeds, which would otherwise
  // flip this straight to the status panel mid-wizard — unmounting the recovery-kit screen
  // (and its one-time password) before the admin has seen or saved it. `mode` is seeded
  // once from the first successful load and after that only changes via explicit user
  // actions (BackupWizard's `onConfigured`, StatusPanel's "Change destination").
  const [mode, setMode] = useState<"wizard" | "status" | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current || !data) return;
    seededRef.current = true;
    setMode(data.config.destination === null ? "wizard" : "status");
  }, [data]);

  if (isLoading || !data || mode === null) {
    return (
      <SettingSection title="Backups">
        <RowsSkeleton rows={2} />
      </SettingSection>
    );
  }

  return (
    <SettingSection title="Backups" description="Encrypted, incremental backups of every user's study tree via restic.">
      {mode === "wizard" ? (
        <BackupWizard onConfigured={() => setMode("status")} />
      ) : (
        <StatusPanel onChangeDestination={() => setMode("wizard")} />
      )}
    </SettingSection>
  );
};

export default BackupsSection;
