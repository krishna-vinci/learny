import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";

/**
 * Signs out via `POST /api/auth/signout`, clears the whole React Query cache (so a
 * different user — or the same one signing back in — never sees stale data), and sends
 * the browser to `/auth`. Shared by the sidebar's "Sign out" row and the Settings general
 * section.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.auth.signout();
    } catch (err) {
      // A 401 here just means the session was already gone — still proceed to /auth.
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error(err instanceof ApiError ? err.message : "Failed to sign out.");
        setSigningOut(false);
        return;
      }
    }
    queryClient.clear();
    navigate("/auth", { replace: true });
  }

  return { signOut, signingOut };
}
