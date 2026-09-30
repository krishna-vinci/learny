// First-run admin creation, shown when `GET /api/auth/status` reports `setupRequired`.
// Not a Memos port (Memos has no first-run setup screen — its admin is seeded by env).
import { useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys, useAuthStatus } from "@/api/queries";
import AuthPageLayout from "@/components/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notify";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function Setup() {
  const { data: status, isLoading } = useAuthStatus();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [codeRequired, setCodeRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return null;
  // Setup already happened (or never was needed) — nothing to do here.
  if (status && !status.setupRequired) return <Navigate to="/auth" replace />;

  const usernameValid = username === "" || USERNAME_PATTERN.test(username);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!USERNAME_PATTERN.test(username)) {
      toast.error("Username must be lowercase letters, numbers, - or _, starting with a letter or number.");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await api.auth.setup({ username, password, ...(setupCode ? { setupCode } : {}) });
      queryClient.setQueryData(queryKeys.me, { user });
      queryClient.invalidateQueries({ queryKey: queryKeys.authStatus });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setCodeRequired(true);
        toast.error("Invalid setup code.");
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to create the admin account.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout title="Set up Studium" subtitle="Create the first admin account for this instance.">
      <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-username">Username</Label>
          <Input
            id="setup-username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
            aria-invalid={!usernameValid}
          />
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, <span className="font-mono">-</span> or <span className="font-mono">_</span>,
            starting with a letter or number. This can't be changed later.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-password">Password</Label>
          <Input
            id="setup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-password-confirm">Confirm password</Label>
          <Input
            id="setup-password-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        {(codeRequired || setupCode) && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-code">Setup code</Label>
            <Input
              id="setup-code"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              autoComplete="off"
              placeholder="Printed in the server log on first boot"
              required={codeRequired}
            />
          </div>
        )}
        {!codeRequired && !setupCode && (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setCodeRequired(true)}
          >
            I have a setup code
          </button>
        )}
        <Button type="submit" disabled={submitting}>
          Create admin account
          {submitting && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
        </Button>
      </form>
    </AuthPageLayout>
  );
}

export default Setup;
