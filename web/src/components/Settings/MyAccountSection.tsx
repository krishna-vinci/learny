// Modeled on Memos' MyAccountSection.tsx (MIT) — https://github.com/usememos/memos
// No avatars/descriptions/account-deletion here (Studium users are admin-managed; see
// MembersSection for archive/purge), so this ports just the profile + password change.
import { KeyRoundIcon, PenLineIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { ApiError } from "@/api/client";
import { useChangePassword, useCurrentUser, useUpdateMe } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

function EditProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useCurrentUser();
  const updateMe = useUpdateMe();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (open && user) {
      setDisplayName(user.displayName);
      setEmail(user.email);
    }
  }, [open, user]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await updateMe.mutateAsync({ displayName, email });
      toast.success("Profile updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update profile.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-display-name">Display name</Label>
            <Input id="account-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={updateMe.isPending}>
              {updateMe.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useCurrentUser();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    try {
      await changePassword.mutateAsync({
        newPassword,
        ...(user?.hasPassword ? { currentPassword } : {}),
      });
      toast.success("Password changed. Other sessions were signed out.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to change password.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {user?.hasPassword && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-current-password">Current password</Label>
              <Input
                id="account-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-new-password">New password</Label>
            <Input
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-new-password-confirm">Confirm new password</Label>
            <Input
              id="account-new-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const MyAccountSection = () => {
  const { user } = useCurrentUser();
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <SettingSection title="My account">
      <SettingGroup title="Profile">
        <div className="flex w-full flex-row flex-wrap items-center justify-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-accent-foreground">
            {(user?.displayName || user?.username || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-40 flex-1">
            <div>
              <span className="text-lg font-semibold text-foreground">{user?.displayName || user?.username}</span>
              <span className="ml-2 text-sm text-muted-foreground">@{user?.username}</span>
            </div>
            {user?.email && <p className="truncate text-sm text-muted-foreground">{user.email}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" className="h-11 sm:h-7" onClick={() => setEditOpen(true)}>
              <PenLineIcon className="size-4" aria-hidden="true" />
              Edit
            </Button>
            <Button variant="outline" size="sm" className="h-11 sm:h-7" onClick={() => setPasswordOpen(true)}>
              <KeyRoundIcon className="size-4" aria-hidden="true" />
              Change password
            </Button>
          </div>
        </div>
      </SettingGroup>

      <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </SettingSection>
  );
};

export default MyAccountSection;
