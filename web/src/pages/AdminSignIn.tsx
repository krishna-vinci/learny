// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Reachable even when the instance disallows password sign-in for regular users: admins
// can always use a password (server/src/auth/routes.ts `/signin` — avoids lockout, same
// as Memos' break-glass).
import { ArrowLeftIcon, ShieldCheckIcon } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuthStatus, useCurrentUser } from "@/api/queries";
import AuthPageLayout, { AuthChip } from "@/components/AuthPageLayout";
import PasswordSignInForm from "@/components/PasswordSignInForm";

const AdminSignIn = () => {
  const { data: status, isLoading: statusLoading } = useAuthStatus();
  const { user, isLoading: meLoading } = useCurrentUser();

  if (statusLoading || meLoading) return null;
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;

  return (
    <AuthPageLayout
      chip={
        <AuthChip>
          <ShieldCheckIcon className="size-3" aria-hidden="true" />
          Admin
        </AuthChip>
      }
      title="Admin sign-in"
      subtitle="Sign in with an admin username and password."
    >
      <PasswordSignInForm />
      <p className="mt-5 text-center text-sm">
        <Link to="/auth" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      </p>
    </AuthPageLayout>
  );
};

export default AdminSignIn;
