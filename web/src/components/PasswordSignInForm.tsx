// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Connect-RPC sign-in call replaced with api.auth.login; identity providers, the
// sign-up link, and ChallengeWidget are removed (not part of Studium's auth).

import { useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import CredentialFields from "@/components/CredentialFields";
import { Button } from "@/components/ui/button";

interface PasswordSignInFormProps {
  redirectPath?: string;
}

function PasswordSignInForm({ redirectPath }: PasswordSignInFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (username === "" || password === "") return;
    if (isLoading) return;

    setIsLoading(true);
    try {
      const { user } = await api.auth.signin(username, password);
      queryClient.setQueryData(queryKeys.me, { user });
      navigate(redirectPath || "/", { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to sign in.";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleFormSubmit}>
      <CredentialFields
        idPrefix="signin"
        username={username}
        password={password}
        readOnly={isLoading}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
      />
      <Button type="submit" disabled={isLoading}>
        Sign in
        {isLoading && <LoaderIcon className="ml-1 h-4 w-auto animate-spin opacity-60" />}
      </Button>
    </form>
  );
}

export default PasswordSignInForm;
