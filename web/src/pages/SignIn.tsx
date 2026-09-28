// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Identity providers and sign-up link removed (not part of Studium's auth).
import { useSearchParams } from "react-router-dom";
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

  return (
    <AuthPageLayout title="Sign in" subtitle="Welcome back">
      <PasswordSignInForm redirectPath={redirectTarget} />
    </AuthPageLayout>
  );
};

export default SignIn;
