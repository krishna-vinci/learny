// Modeled on Memos' AuthCallback.tsx (MIT) — https://github.com/usememos/memos
// Adapted to our REST `/api/auth/sso` and `/api/me/identities` endpoints (Memos calls a
// single Connect-RPC signIn with a oneof credentials case) and to `sessionStorage`-backed
// PKCE state from `@/lib/oauth` instead of Memos' own `storeOAuthState`/`validateOAuthState`.
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import AuthPageLayout from "@/components/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { consumePendingOAuthState, safeReturnUrl } from "@/lib/oauth";

interface State {
  loading: boolean;
  errorMessage: string;
}

const AuthCallback = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const handledRef = useRef(false);
  const [state, setState] = useState<State>({ loading: true, errorMessage: "" });

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const oauthError = searchParams.get("error");
    if (oauthError) {
      const description = searchParams.get("error_description");
      setState({
        loading: false,
        errorMessage: description ? `${oauthError}: ${decodeURIComponent(description)}` : `OAuth error: ${oauthError}`,
      });
      return;
    }

    const code = searchParams.get("code");
    const receivedState = searchParams.get("state");
    if (!code || !receivedState) {
      setState({ loading: false, errorMessage: "Missing authorization code or state parameter." });
      return;
    }

    const pending = consumePendingOAuthState(receivedState);
    if (!pending) {
      setState({
        loading: false,
        errorMessage: "This sign-in link expired or was already used. Go back and try again.",
      });
      return;
    }

    const redirectUri = new URL("/auth/callback", window.location.origin).toString();
    const body = {
      providerId: pending.providerId,
      code,
      redirectUri,
      codeVerifier: pending.codeVerifier,
    };

    (async () => {
      try {
        if (pending.mode === "link") {
          await api.me.linkIdentity(body);
          queryClient.invalidateQueries({ queryKey: queryKeys.meIdentities });
        } else {
          const { user } = await api.auth.sso(body);
          queryClient.setQueryData(queryKeys.me, { user });
        }
        navigate(safeReturnUrl(pending.returnUrl), { replace: true });
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : "Failed to complete sign-in with this identity provider.";
        setState({ loading: false, errorMessage: message });
      }
    })();
  }, [searchParams, navigate, queryClient]);

  if (state.loading) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center">
        <LoaderIcon className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <AuthPageLayout title="Sign-in failed">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">{state.errorMessage}</p>
        <Button variant="outline" className="mt-2 h-11 sm:h-9" onClick={() => navigate("/auth", { replace: true })}>
          Back to sign in
        </Button>
      </div>
    </AuthPageLayout>
  );
};

export default AuthCallback;
