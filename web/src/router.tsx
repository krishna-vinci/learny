import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { api } from "@/api/client";
import { useSets } from "@/api/queries";
import { NewSetDialog } from "@/components/NewSetDialog";
import { Button } from "@/components/ui/button";
import RootLayout from "@/layouts/RootLayout";
import CardFilePage from "@/pages/CardFilePage";
import CardsPage from "@/pages/CardsPage";
import InboxPage from "@/pages/InboxPage";
import JobsPage from "@/pages/JobsPage";
import LibraryPage from "@/pages/LibraryPage";
import LibrarySourcePage from "@/pages/LibrarySourcePage";
import NotePage from "@/pages/NotePage";
import SetHomePage from "@/pages/SetHomePage";
import SetsPage from "@/pages/SetsPage";
import SettingsPage from "@/pages/SettingsPage";
import SignIn from "@/pages/SignIn";
import { useLastVisitedSet } from "@/pages/useLastVisitedSet";

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
  const lastVisitedSet = useLastVisitedSet();
  const [newSetOpen, setNewSetOpen] = useState(false);
  if (isLoading) return null;
  if (!sets || sets.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
        <p className="text-lg font-semibold text-foreground">Create your first study set</p>
        <p className="text-sm text-muted-foreground">
          A study set holds the notes, sources, and cards for one thing you're learning.
        </p>
        <Button className="mt-2 h-11" onClick={() => setNewSetOpen(true)}>
          New study set
        </Button>
        <NewSetDialog open={newSetOpen} onOpenChange={setNewSetOpen} />
      </div>
    );
  }
  // "/" goes to the last-visited set if it still exists, else the only set, else the
  // "All study sets" page — never a hardcoded first set that may not be the one the
  // person meant to land on.
  const remembered = lastVisitedSet && sets.some((set) => set.slug === lastVisitedSet) ? lastVisitedSet : null;
  if (remembered) return <Navigate to={`/s/${remembered}`} replace />;
  if (sets.length === 1) return <Navigate to={`/s/${sets[0]?.slug}`} replace />;
  return <Navigate to="/sets" replace />;
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
      { path: "sets", element: <SetsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "s/:set", element: <SetHomePage /> },
      { path: "s/:set/inbox", element: <InboxPage /> },
      { path: "s/:set/cards", element: <CardsPage /> },
      { path: "s/:set/cards/*", element: <CardFilePage /> },
      { path: "s/:set/n/*", element: <NotePage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "library/:id", element: <LibrarySourcePage /> },
    ],
  },
]);
