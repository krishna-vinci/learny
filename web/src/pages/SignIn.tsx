// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Sign-up link removed (not part of Studium's auth — no public sign-up, ever).
import { ArrowRightIcon, LockIcon } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuthStatus, useCurrentUser } from "@/api/queries";
import AuthPageLayout from "@/components/AuthPageLayout";
import IdentityProviderButtons from "@/components/IdentityProviderButtons";
import PasswordSignInForm from "@/components/PasswordSignInForm";
import { Separator } from "@/components/ui/separator";
import { safeReturnUrl } from "@/lib/oauth";

function getSafeRedirectPath(raw: string | null): string | undefined {
  if (!raw) return undefined;
  // Only allow same-origin, path-relative redirects.
  const safe = safeReturnUrl(raw);
  return safe === "/" && raw !== "/" ? undefined : safe;
}

const SignIn = () => {
  const [searchParams] = useSearchParams();
  const redirectTarget = getSafeRedirectPath(searchParams.get("redirect"));
  const { data: status, isLoading: statusLoading } = useAuthStatus();
  const { user, isLoading: meLoading } = useCurrentUser();

  if (statusLoading || meLoading) return null;
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={redirectTarget || "/"} replace />;

  const passwordAuthAllowed = !status?.disallowPasswordAuth;
  const identityProviders = status?.identityProviders ?? [];
  const hasIdentityProviders = identityProviders.length > 0;
  const showAuthOptions = passwordAuthAllowed || hasIdentityProviders;

  return (
    <AuthPageLayout title="Sign in" subtitle={showAuthOptions ? "Welcome back" : undefined}>
      {showAuthOptions ? (
        <>
          {hasIdentityProviders && (
            <IdentityProviderButtons
              identityProviders={identityProviders}
              mode="signin"
              returnUrl={redirectTarget || "/"}
            />
          )}
          {hasIdentityProviders && passwordAuthAllowed && (
            <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
              <div className="flex-1">
                <Separator />
              </div>
              or
              <div className="flex-1">
                <Separator />
              </div>
            </div>
          )}
          {passwordAuthAllowed && <PasswordSignInForm redirectPath={redirectTarget} />}
          {!passwordAuthAllowed && (
            <p className="mt-1 text-center text-sm">
              <Link to="/auth/admin" className="inline-flex items-center gap-1 text-primary hover:underline">
                Admin sign-in
                <ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </Link>
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <LockIcon className="size-4" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">Password sign-in is disabled for this instance.</p>
          <Link to="/auth/admin" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            Admin sign-in
            <ArrowRightIcon className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </AuthPageLayout>
  );
};

export default SignIn;
