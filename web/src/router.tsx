import { LibraryBigIcon } from "lucide-react";
import { type ComponentType, lazy, type ReactNode, Suspense, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStatus, useCurrentUser, useSets } from "@/api/queries";
import { PageSkeleton } from "@/components/ListSkeleton";
import { NewSetDialog } from "@/components/NewSetDialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import RootLayout from "@/layouts/RootLayout";
import { setSkipped, wasSkipped } from "@/lib/onboarding";
import RouteError from "@/pages/RouteError";
import TodayPage from "@/pages/TodayPage";

/** Redirects `/login[?redirect=]` (the pre-M3a route) to `/auth`, preserving the query. */
function LegacyLoginRedirect() {
  const [searchParams] = useSearchParams();
  return <Navigate to={`/auth?${searchParams.toString()}`} replace />;
}

function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: status, isLoading: statusLoading } = useAuthStatus();
  const { user, isLoading: meLoading, isError } = useCurrentUser();

  if (statusLoading || meLoading) return null;
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (isError || !user) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const { data: sets, isLoading } = useSets();
  const navigate = useNavigate();
  const [newSetOpen, setNewSetOpen] = useState(false);
  if (isLoading) return null;
  if (!sets || sets.length === 0) {
    // A brand-new learner gets the guided first-run flow; someone who skipped it gets a calm empty state.
    if (!wasSkipped()) return <Navigate to="/welcome" replace />;
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 px-4 py-10">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryBigIcon />
            </EmptyMedia>
            <EmptyTitle>Start your first study set</EmptyTitle>
            <EmptyDescription>
              A study set holds the notes, sources and cards for one thing you're learning. Answer four quick questions
              and we'll make a plan.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              className="h-11 w-full"
              onClick={() => {
                setSkipped(false);
                navigate("/welcome");
              }}
            >
              Get started
            </Button>
            <Button variant="quiet" className="h-11 w-full" onClick={() => setNewSetOpen(true)}>
              Just create an empty set
            </Button>
          </EmptyContent>
        </Empty>
        <NewSetDialog open={newSetOpen} onOpenChange={setNewSetOpen} />
      </div>
    );
  }
  return <Navigate to="/today" replace />;
}

/** Route code is fetched when the route is first visited; only the shell and Today ship up front. */
const page = (load: () => Promise<{ default: ComponentType }>) => {
  const Page = lazy(load);
  return {
    element: (
      <Suspense fallback={<PageSkeleton />}>
        <Page />
      </Suspense>
    ),
  };
};

export const router = createBrowserRouter([
  { path: "/login", element: <LegacyLoginRedirect /> },
  { path: "/setup", ...page(() => import("@/pages/Setup")) },
  { path: "/auth", ...page(() => import("@/pages/SignIn")) },
  { path: "/auth/admin", ...page(() => import("@/pages/AdminSignIn")) },
  { path: "/auth/callback", ...page(() => import("@/pages/AuthCallback")) },
  {
    path: "/welcome",
    element: (
      <AuthGate>
        <Outlet />
      </AuthGate>
    ),
    children: [{ index: true, ...page(() => import("@/pages/WelcomePage")) }],
  },
  {
    path: "/",
    element: (
      <AuthGate>
        <RootLayout />
      </AuthGate>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: "today", element: <TodayPage /> },
      { path: "sets", ...page(() => import("@/pages/SetsPage")) },
      { path: "settings", ...page(() => import("@/pages/SettingsPage")) },
      { path: "settings/:section", ...page(() => import("@/pages/SettingsPage")) },
      { path: "jobs", ...page(() => import("@/pages/JobsPage")) },
      { path: "s/:set", ...page(() => import("@/pages/SetHomePage")) },
      { path: "s/:set/plan", ...page(() => import("@/pages/PlanPage")) },
      { path: "s/:set/practice", ...page(() => import("@/pages/PracticePage")) },
      { path: "s/:set/inbox", ...page(() => import("@/pages/InboxPage")) },
      { path: "s/:set/cards", ...page(() => import("@/pages/CardsPage")) },
      { path: "s/:set/cards/*", ...page(() => import("@/pages/CardFilePage")) },
      { path: "s/:set/n/*", ...page(() => import("@/pages/NotePage")) },
      { path: "library", ...page(() => import("@/pages/LibraryPage")) },
      { path: "library/:id", ...page(() => import("@/pages/LibrarySourcePage")) },
    ],
  },
]);
