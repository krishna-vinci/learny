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
