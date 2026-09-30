// Admin "SSO" section — identity provider CRUD. Not a direct Memos port (Memos' SSOSection
// drives protobuf oneof config cases); this targets `/api/admin/identity-providers`
// (server/src/sso/routes.ts) and the GitHub/Google/GitLab/Custom templates from
// docs/plans/2026-09-29-m3a-platform.md T3.
import { CopyIcon, KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, type IdentityProviderAdmin, type IdentityProviderInput } from "@/api/client";
import {
  useAdminIdentityProviders,
  useCreateIdentityProvider,
  useDeleteIdentityProvider,
  useUpdateIdentityProvider,
} from "@/api/queries";
import ConfirmDialog from "@/components/ConfirmDialog";
import { RowsSkeleton } from "@/components/ListSkeleton";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/notify";
import { callbackRedirectUri } from "@/lib/oauth";
import { IDP_TEMPLATES, type IdpTemplate } from "./idp-templates";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CallbackUrlRow() {
  const url = callbackRedirectUri();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
      <code className="min-w-0 flex-1 truncate text-sm">{url}</code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 shrink-0 sm:size-8"
        aria-label="Copy callback URL"
        onClick={async () => {
          const ok = await copyToClipboard(url);
          toast[ok ? "success" : "error"](ok ? "Copied" : "Couldn't copy — select and copy manually.");
        }}
      >
        <CopyIcon className="size-4" />
      </Button>
    </div>
  );
}

interface FormState {
  title: string;
  identifierFilter: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string;
  identifier: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  autoLinkByEmail: boolean;
}

function emptyForm(): FormState {
  return {
    title: "",
    identifierFilter: "",
    clientId: "",
    clientSecret: "",
    authUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    scopes: "",
    identifier: "",
    displayName: "",
    email: "",
    avatarUrl: "",
    autoLinkByEmail: false,
  };
}

function formFromProvider(provider: IdentityProviderAdmin): FormState {
  return {
    title: provider.title,
    identifierFilter: provider.identifierFilter,
    clientId: provider.clientId,
    clientSecret: "",
    authUrl: provider.authUrl,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl,
    scopes: provider.scopes.join(" "),
    identifier: provider.fieldMapping.identifier,
    displayName: provider.fieldMapping.displayName,
    email: provider.fieldMapping.email,
    avatarUrl: provider.fieldMapping.avatarUrl,
    autoLinkByEmail: provider.autoLinkByEmail,
  };
}

function applyTemplate(form: FormState, template: IdpTemplate): FormState {
  return {
    ...form,
    authUrl: template.authUrl,
    tokenUrl: template.tokenUrl,
    userInfoUrl: template.userInfoUrl,
    scopes: template.scopes.join(" "),
    identifier: template.fieldMapping.identifier,
    displayName: template.fieldMapping.displayName,
    email: template.fieldMapping.email,
    avatarUrl: template.fieldMapping.avatarUrl,
    ...(form.title === "" && template.key !== "custom" ? { title: template.label } : {}),
  };
}

function toInput(form: FormState): IdentityProviderInput {
  return {
    title: form.title.trim(),
    type: "OAUTH2",
    identifierFilter: form.identifierFilter.trim(),
    clientId: form.clientId.trim(),
    ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
    authUrl: form.authUrl.trim(),
    tokenUrl: form.tokenUrl.trim(),
    userInfoUrl: form.userInfoUrl.trim(),
    scopes: form.scopes.trim() === "" ? [] : form.scopes.trim().split(/\s+/),
    fieldMapping: {
      identifier: form.identifier.trim(),
      displayName: form.displayName.trim(),
      email: form.email.trim(),
      avatarUrl: form.avatarUrl.trim(),
    },
    autoLinkByEmail: form.autoLinkByEmail,
  };
}

function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: IdentityProviderAdmin | null;
}) {
  const isEdit = provider !== null;
  const create = useCreateIdentityProvider();
  const update = useUpdateIdentityProvider();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [templateKey, setTemplateKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) setForm(provider ? formFromProvider(provider) : emptyForm());
    if (open) setTemplateKey(null);
  }, [open, provider]);

  const pending = create.isPending || update.isPending;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = toInput(form);
    if (!input.title) {
      toast.error("Title is required.");
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: provider.id, patch: input });
      } else {
        await create.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save provider.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${provider.title}` : "Add identity provider"}</DialogTitle>
          <DialogDescription>OAuth2 sign-in for an existing Studium account — no public sign-up.</DialogDescription>
        </DialogHeader>
        <form className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pe-1" onSubmit={handleSubmit}>
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label>Template</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {IDP_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className={`h-11 rounded-md border px-2 text-sm transition-colors sm:h-9 ${
                      templateKey === template.key
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border hover:bg-accent/60"
                    }`}
                    onClick={() => {
                      setTemplateKey(template.key);
                      setForm((prev) => applyTemplate(prev, template));
                    }}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp-title">Title</Label>
            <Input
              id="idp-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idp-client-id">Client ID</Label>
              <Input
                id="idp-client-id"
                value={form.clientId}
                onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idp-client-secret">Client secret</Label>
              <Input
                id="idp-client-secret"
                type="password"
                value={form.clientSecret}
                onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                placeholder={isEdit ? "Set — leave blank to keep it" : ""}
                required={!isEdit}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp-auth-url">Authorize URL</Label>
            <Input
              id="idp-auth-url"
              value={form.authUrl}
              onChange={(e) => setForm((f) => ({ ...f, authUrl: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp-token-url">Token URL</Label>
            <Input
              id="idp-token-url"
              value={form.tokenUrl}
              onChange={(e) => setForm((f) => ({ ...f, tokenUrl: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp-userinfo-url">User info URL</Label>
            <Input
              id="idp-userinfo-url"
              value={form.userInfoUrl}
              onChange={(e) => setForm((f) => ({ ...f, userInfoUrl: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp-scopes">Scopes (space-separated)</Label>
            <Input
              id="idp-scopes"
              value={form.scopes}
              onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idp-map-identifier">Identifier field</Label>
              <Input
                id="idp-map-identifier"
                value={form.identifier}
                onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idp-map-display-name">Display name field</Label>
              <Input
                id="idp-map-display-name"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idp-map-email">Email field</Label>
              <Input
                id="idp-map-email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="idp-map-avatar">Avatar URL field</Label>
              <Input
                id="idp-map-avatar"
                value={form.avatarUrl}
                onChange={(e) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idp-identifier-filter">Identifier filter (regex, optional)</Label>
            <Input
              id="idp-identifier-filter"
              value={form.identifierFilter}
              onChange={(e) => setForm((f) => ({ ...f, identifierFilter: e.target.value }))}
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor="idp-auto-link">Auto-link by email</Label>
              <p className="mt-1 text-xs text-warning-foreground">
                Only enable if this provider verifies email addresses; never links admins.
              </p>
            </div>
            <Switch
              id="idp-auto-link"
              checked={form.autoLinkByEmail}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, autoLinkByEmail: checked }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Callback URL</Label>
            <CallbackUrlRow />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-8" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SSOSection = () => {
  const { data, isLoading } = useAdminIdentityProviders();
  const deleteProvider = useDeleteIdentityProvider();
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IdentityProviderAdmin | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IdentityProviderAdmin | null>(null);
  const providers = data?.identityProviders ?? [];

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteProvider.mutateAsync(deleteTarget.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove provider.");
    }
  }

  return (
    <SettingSection
      title="SSO"
      description="OAuth2 identity providers. Sign-in links an existing account — SSO never creates one."
      actions={
        <Button
          size="sm"
          className="h-11 sm:h-8"
          onClick={() => {
            setEditTarget(null);
            setFormOpen(true);
          }}
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          Add provider
        </Button>
      }
    >
      <SettingGroup title="Callback URL" description="Register this as the redirect/callback URL with each provider.">
        <CallbackUrlRow />
      </SettingGroup>

      {isLoading ? (
        <RowsSkeleton rows={2} />
      ) : providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <KeyRoundIcon className="size-4" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground">No identity providers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add GitHub, Google, GitLab, or a custom OAuth2 provider.</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
          {providers.map((provider) => (
            <li key={provider.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{provider.title}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {provider.authUrl} · {provider.hasClientSecret ? "secret set" : "no secret"}
                  {provider.autoLinkByEmail ? " · auto-link by email" : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 sm:h-7"
                onClick={() => {
                  setEditTarget(provider);
                  setFormOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-muted-foreground hover:text-destructive sm:size-7"
                aria-label="Delete"
                onClick={() => setDeleteTarget(provider)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ProviderFormDialog
        key={editTarget?.id ?? "new"}
        open={formOpen}
        onOpenChange={setFormOpen}
        provider={editTarget}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Remove ${deleteTarget.title}?` : ""}
        description="Members who signed in only through this provider won't be able to sign in until it's re-added or given a password."
        confirmLabel="Remove"
        confirmVariant="destructive"
        onConfirm={handleDelete}
      />
    </SettingSection>
  );
};

export default SSOSection;
