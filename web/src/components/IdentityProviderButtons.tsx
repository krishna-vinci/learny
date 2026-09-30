// Adapted from Memos (MIT) — https://github.com/usememos/memos
// One button per identity provider from `GET /api/auth/status`, redirecting into the
// PKCE authorize flow (`@/lib/oauth`). Shared by SignIn (mode "signin") and
// LinkedIdentitySection (mode "link").
import { KeyRoundIcon } from "lucide-react";
import type { PublicIdentityProvider } from "@/api/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/notify";
import { startOAuthFlow } from "@/lib/oauth";

interface Props {
  identityProviders: PublicIdentityProvider[];
  mode: "signin" | "link";
  returnUrl: string;
  label?: (title: string) => string;
}

const IdentityProviderButtons = ({ identityProviders, mode, returnUrl, label }: Props) => {
  async function start(provider: PublicIdentityProvider) {
    try {
      const url = await startOAuthFlow(provider, { mode, returnUrl });
      window.location.href = url;
    } catch {
      toast.error("Failed to start sign-in with this provider.");
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {identityProviders.map((provider) => (
        <Button
          key={provider.id}
          type="button"
          variant="outline"
          className="h-11 justify-start gap-2 sm:h-9"
          onClick={() => void start(provider)}
        >
          <KeyRoundIcon className="size-4" aria-hidden="true" />
          {label ? label(provider.title) : `Continue with ${provider.title}`}
        </Button>
      ))}
    </div>
  );
};

export default IdentityProviderButtons;
