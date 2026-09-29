// Modeled on Memos' MemberSection.tsx (MIT) — https://github.com/usememos/memos
// Studium has no invite links (no public sign-up, ever — docs/plans, Global constraints);
// members are created directly by the admin with an optional password, and the danger
// zone splits into archive (reversible) vs. purge (moves the user's tree to trash, typed
// confirm) rather than Memos' single delete.
import { PlusIcon, ShieldCheckIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { ApiError, type User, type UserRole } from "@/api/client";
import { useAdminUsers, useCreateUser, useCurrentUser, useDeleteUser, useUpdateUser } from "@/api/queries";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import SettingSection from "./SettingSection";

function CreateMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createUser = useCreateUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("USER");
  const [aiEnabled, setAiEnabled] = useState(true);

  function reset() {
    setUsername("");
    setPassword("");
    setRole("USER");
    setAiEnabled(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await createUser.mutateAsync({
        username,
        role,
        aiEnabled,
        ...(password ? { password } : {}),
      });
      toast.success(`Member ${username} created`);
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create member.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New member</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-username">Username</Label>
            <Input
              id="member-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, - or _, starting with a letter or number. Can't be changed later.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-password">Password (optional)</Label>
            <Input
              id="member-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Leave blank for SSO-only"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="member-role">Admin</Label>
            <Switch
              id="member-role"
              checked={role === "ADMIN"}
              onCheckedChange={(checked) => setRole(checked ? "ADMIN" : "USER")}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="member-ai">AI features</Label>
            <Switch id="member-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={createUser.isPending}>
              {createUser.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({ user, onOpenChange }: { user: User | null; onOpenChange: (open: boolean) => void }) {
  const updateUser = useUpdateUser();
  const [role, setRole] = useState<UserRole>(user?.role ?? "USER");
  const [aiEnabled, setAiEnabled] = useState(user?.aiEnabled ?? true);
  const [newPassword, setNewPassword] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    try {
      await updateUser.mutateAsync({
        id: user.id,
        patch: { role, aiEnabled, ...(newPassword ? { password: newPassword } : {}) },
      });
      toast.success(`${user.username} updated`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member.");
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent key={user?.id}>
        <DialogHeader>
          <DialogTitle>Edit {user?.username}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-member-role">Admin</Label>
            <Switch
              id="edit-member-role"
              defaultChecked={user?.role === "ADMIN"}
              onCheckedChange={(checked) => setRole(checked ? "ADMIN" : "USER")}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-member-ai">AI features</Label>
            <Switch id="edit-member-ai" defaultChecked={user?.aiEnabled} onCheckedChange={setAiEnabled} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-member-password">Reset password</Label>
            <Input
              id="edit-member-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={updateUser.isPending}>
              {updateUser.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const MembersSection = () => {
  const { user: currentUser } = useCurrentUser();
  const { data, isLoading } = useAdminUsers();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<User | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<User | null>(null);
  const users = data?.users ?? [];

  async function toggleArchive(target: User) {
    try {
      await updateUser.mutateAsync({
        id: target.id,
        patch: { state: target.state === "NORMAL" ? "ARCHIVED" : "NORMAL" },
      });
      toast.success(target.state === "NORMAL" ? `${target.username} archived` : `${target.username} restored`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member.");
    }
  }

  async function handlePurge() {
    if (!purgeTarget) return;
    try {
      await deleteUser.mutateAsync({ id: purgeTarget.id, purge: true });
      toast.success(`${purgeTarget.username}'s data was purged`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to purge member.");
    }
  }

  return (
    <SettingSection
      title="Members"
      description="Only an admin can create accounts — there is no public sign-up."
      actions={
        <Button size="sm" className="h-11 sm:h-8" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" aria-hidden="true" />
          New member
        </Button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {u.role === "ADMIN" ? (
                <ShieldCheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium text-foreground">{u.displayName || u.username}</span>
                  <span className="text-muted-foreground">@{u.username}</span>
                  {u.state === "ARCHIVED" && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
                      Archived
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {u.role === "ADMIN" ? "Admin" : "Member"} · AI {u.aiEnabled ? "on" : "off"}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" className="h-11 sm:h-7" onClick={() => setEditTarget(u)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-7"
                  disabled={u.id === currentUser?.id}
                  onClick={() => (u.state === "NORMAL" ? setArchiveTarget(u) : void toggleArchive(u))}
                >
                  {u.state === "NORMAL" ? "Archive" : "Restore"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-muted-foreground hover:text-destructive sm:size-7"
                  disabled={u.id === currentUser?.id}
                  aria-label="Purge"
                  onClick={() => setPurgeTarget(u)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateMemberDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditMemberDialog key={editTarget?.id} user={editTarget} onOpenChange={(open) => !open && setEditTarget(null)} />
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={archiveTarget ? `Archive ${archiveTarget.username}?` : ""}
        description="They won't be able to sign in until restored. Their data is kept."
        confirmLabel="Archive"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (archiveTarget) await toggleArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => !open && setPurgeTarget(null)}
        title={purgeTarget ? `Purge ${purgeTarget.username}'s account?` : ""}
        description="This moves their entire study tree to trash and permanently deletes the account. This can't be undone from the UI."
        confirmLabel="Purge"
        confirmVariant="destructive"
        typedConfirmValue={purgeTarget?.username}
        onConfirm={handlePurge}
      />
    </SettingSection>
  );
};

export default MembersSection;
