// Modeled on Memos' LinkedIdentitySection.tsx (MIT) — https://github.com/usememos/memos
// Trimmed to Studium's shapes: `useAuthStatus().identityProviders` is the public provider
// list (id/title/authUrl/clientId/scopes — same one SignIn uses), cross-referenced with
// `GET /api/me/identities` for which ones this account already has linked.
import { UnlinkIcon } from "lucide-react";
import { toast } from "react-hot-toast";
import { ApiError } from "@/api/client";
import { useAuthStatus, useIdentities, useUnlinkIdentity } from "@/api/queries";
import IdentityProviderButtons from "@/components/IdentityProviderButtons";
import { Button } from "@/components/ui/button";
import { relativeTime } from "./format";
import SettingGroup from "./SettingGroup";

const LinkedIdentitySection = () => {
  const { data: status } = useAuthStatus();
  const { data: identitiesData } = useIdentities();
  const unlink = useUnlinkIdentity();
  const providers = status?.identityProviders ?? [];
  const linked = identitiesData?.identities ?? [];
  const linkedByProvider = new Map(linked.map((identity) => [identity.providerId, identity]));
  const unlinkedProviders = providers.filter((provider) => !linkedByProvider.has(provider.id));

  if (providers.length === 0) return null;

  async function handleUnlink(providerId: number) {
    try {
      await unlink.mutateAsync(providerId);
      toast.success("Identity unlinked");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to unlink identity.");
    }
  }

  return (
    <SettingGroup title="Linked identities" description="Sign in with an external provider instead of a password.">
      {linked.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border p-0">
          {linked.map((identity) => (
            <li key={identity.providerId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{identity.providerTitle}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Linked {relativeTime(identity.createdAt)}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 sm:h-7"
                onClick={() => void handleUnlink(identity.providerId)}
              >
                <UnlinkIcon className="size-3.5" aria-hidden="true" />
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      {unlinkedProviders.length > 0 && (
        <IdentityProviderButtons
          identityProviders={unlinkedProviders}
          mode="link"
          returnUrl="/settings/my-account"
          label={(title) => `Link ${title}`}
        />
      )}
    </SettingGroup>
  );
};

export default LinkedIdentitySection;
