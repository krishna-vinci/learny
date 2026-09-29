import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { RouterProvider } from "react-router-dom";
import { UnauthorizedError } from "@/api/client";
import "@/index.css";
import { router } from "@/router";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof UnauthorizedError) {
        const redirect = `${window.location.pathname}${window.location.search}`;
        router.navigate(`/login?redirect=${encodeURIComponent(redirect)}`);
      }
    },
  }),
  defaultOptions: {
    queries: { retry: false },
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
