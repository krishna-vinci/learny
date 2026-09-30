// Modeled on Memos' AccessTokenSection.tsx (MIT) — https://github.com/usememos/memos
// Trimmed to what Studium needs: no web-clipper/API-usage disclosure copy, and the
// show-once token dialog (Memos copies to clipboard directly) is its own step here so a
// phone user without clipboard access can still read and copy the token.
import { CopyIcon, KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { useAccessTokens, useCreateAccessToken, useDeleteAccessToken } from "@/api/queries";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notify";
import { relativeTime } from "./format";
import SettingSection from "./SettingSection";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (token: string) => void;
}) {
  const createToken = useCreateAccessToken();
  const [description, setDescription] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!description.trim()) return;
    try {
      const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const { token } = await createToken.mutateAsync({
        description: description.trim(),
        ...(days ? { expiresInDays: days } : {}),
      });
      onOpenChange(false);
      setDescription("");
      setExpiresInDays("");
      onCreated(token);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create access token.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New access token</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-description">Description</Label>
            <Input
              id="token-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. CLI on my laptop"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-expires">Expires in (days)</Label>
            <Input
              id="token-expires"
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder="Never"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={createToken.isPending}>
              {createToken.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShowTokenDialog({ token, onOpenChange }: { token: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={token !== null} onOpenChange={onOpenChange}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>Your new access token</DialogTitle>
          <DialogDescription>
            Copy this now — it won't be shown again. Anyone with this token can act as you.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 truncate text-sm">{token}</code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 sm:size-8"
            aria-label="Copy token"
            onClick={async () => {
              const ok = token && (await copyToClipboard(token));
              toast[ok ? "success" : "error"](ok ? "Copied" : "Couldn't copy — select and copy manually.");
            }}
          >
            <CopyIcon className="size-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AccessTokenSection = () => {
  const { data, isLoading } = useAccessTokens();
  const deleteToken = useDeleteAccessToken();
  const [createOpen, setCreateOpen] = useState(false);
  const [shownToken, setShownToken] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const tokens = data?.accessTokens ?? [];

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteToken.mutateAsync(deleteTarget);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete token.");
    }
  }

  return (
    <SettingSection
      title="Access tokens"
      description="Personal access tokens for scripts and API clients (Authorization: Bearer studium_pat_…)."
      actions={
        <Button size="sm" className="h-11 sm:h-8" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" aria-hidden="true" />
          Create
        </Button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tokens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <KeyRoundIcon className="size-4" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground">No access tokens yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one to use the API outside the browser.</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
          {tokens.map((tok) => (
            <li key={tok.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{tok.description}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {tok.lastUsedAt ? `Last used ${relativeTime(tok.lastUsedAt)}` : "Never used"}
                  {" · "}
                  {tok.expiresAt ? `Expires ${relativeTime(tok.expiresAt)}` : "No expiration"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-muted-foreground hover:text-destructive sm:size-8"
                aria-label="Delete"
                onClick={() => setDeleteTarget(tok.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setShownToken} />
      <ShowTokenDialog token={shownToken} onOpenChange={(open) => !open && setShownToken(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this access token?"
        description="Anything using it will stop working immediately."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />
    </SettingSection>
  );
};

export default AccessTokenSection;
