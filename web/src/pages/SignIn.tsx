// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Identity providers are slotted in for slice (b); sign-up link removed (not part of
// Studium's auth — no public sign-up, ever).
import { ArrowRightIcon, LockIcon } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuthStatus, useCurrentUser } from "@/api/queries";
import AuthPageLayout from "@/components/AuthPageLayout";
import PasswordSignInForm from "@/components/PasswordSignInForm";

function getSafeRedirectPath(raw: string | null): string | undefined {
  if (!raw) return undefined;
  // Only allow same-origin, path-relative redirects.
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}

const SignIn = () => {
  const [searchParams] = useSearchParams();
  const redirectTarget = getSafeRedirectPath(searchParams.get("redirect"));
  const { data: status, isLoading: statusLoading } = useAuthStatus();
  const { user, isLoading: meLoading } = useCurrentUser();

  if (statusLoading || meLoading) return null;
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={redirectTarget || "/"} replace />;

  // T6 slice (b) adds one button per identity provider here (`status.identityProviders`).
  const passwordAuthAllowed = !status?.disallowPasswordAuth;

  return (
    <AuthPageLayout title="Sign in" subtitle="Welcome back">
      {passwordAuthAllowed ? (
        <PasswordSignInForm redirectPath={redirectTarget} />
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
