import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { RouterProvider } from "react-router-dom";
import { UnauthorizedError } from "@/api/client";
import "@/index.css";
import { clearOfflineCaches } from "@/lib/offline";
import { router } from "@/router";

// After a deploy, an open tab or installed PWA still runs the previous build and asks for lazy
// chunks (KaTeX, Mermaid, visuals…) that no longer exist. Vite reports that as
// `vite:preloadError`: reload once to pick up the new build. The timestamp guard stops a loop
// when the failure is real (e.g. offline).
window.addEventListener("vite:preloadError", (event) => {
  const key = "studium:chunk-reload";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(key) ?? 0);
  } catch {}
  if (Date.now() - last < 60_000) return;
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {}
  event.preventDefault();
  window.location.reload();
});

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (!(error instanceof UnauthorizedError)) return;
      const { pathname, search } = window.location;
      // Signing out (or a session expiring) can fail several still-in-flight queries at
      // once, each raising this. Once we're already on/heading to an auth page, further
      // 401s must be a no-op — otherwise each one re-reads `window.location` (which
      // already carries the previous redirect target) and wraps it in another
      // `redirect=`, compounding into an ever-growing, never-terminating URL.
      if (pathname === "/setup" || pathname === "/auth" || pathname.startsWith("/auth/")) return;
      void clearOfflineCaches();
      router.navigate(`/auth?redirect=${encodeURIComponent(`${pathname}${search}`)}`);
    },
  }),
  defaultOptions: {
    // `always`: don't pause queries/mutations while the browser says it's offline. Reads then reach the
    // service worker's offline cache; writes fail at once with "You're offline" instead of queueing.
    queries: { retry: false, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("root element not found");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);

// VitePWA's `injectRegister: "auto"` (the default) already registers the service worker;
// this just makes a fresh deploy actually take over an already-open tab (e.g. the PWA on
// a phone that was never closed). `skipWaiting`/`clientsClaim` in vite.config.ts let a new
// SW activate and take control immediately; the reload here — guarded so it fires once —
// picks up the new `index.html`/bundle it now controls, instead of leaving the page
// running on stale JS until the user manually reloads or clears the cache.
if ("serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
