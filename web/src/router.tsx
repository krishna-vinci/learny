import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { useSets } from "@/api/queries";
import RootLayout from "@/layouts/RootLayout";
import InboxPage from "@/pages/InboxPage";
import JobsPage from "@/pages/JobsPage";
import LibraryPage from "@/pages/LibraryPage";
import LibrarySourcePage from "@/pages/LibrarySourcePage";
import NotePage from "@/pages/NotePage";
import SettingsPage from "@/pages/SettingsPage";
import SignIn from "@/pages/SignIn";

function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isLoading, isError } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.auth.me(),
    retry: false,
  });

  if (isLoading) return null;
  if (isError) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const { data: sets, isLoading } = useSets();
  if (isLoading) return null;
  if (!sets || sets.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No study sets yet.</div>;
  }
  return <Navigate to={`/s/${sets[0]?.slug}`} replace />;
}

// Placeholder page: Task 9 (chat dock) fills the real content.
// It exists so the router and sidebar navigation work end to end in this task.
function SetOverviewPlaceholder() {
  const { set } = useParams<{ set: string }>();
  return <div className="p-6 text-sm text-muted-foreground">Select a note from “{set}” in the sidebar.</div>;
}

export const router = createBrowserRouter([
  { path: "/login", element: <SignIn /> },
  {
    path: "/",
    element: (
      <AuthGate>
        <RootLayout />
      </AuthGate>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "s/:set", element: <SetOverviewPlaceholder /> },
      { path: "s/:set/inbox", element: <InboxPage /> },
      { path: "s/:set/n/*", element: <NotePage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/:id", element: <LibrarySourcePage /> },
    ],
  },
]);
