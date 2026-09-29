import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = import.meta.dirname;

const devProxyServer = process.env.DEV_PROXY_SERVER || "http://127.0.0.1:3000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Studium",
        short_name: "Studium",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#2b4a6f",
        background_color: "#f7f5ef",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // `push`/`notificationclick` handling for Web Push (M3a T6 slice d), spliced into
        // the generated service worker rather than switching to `injectManifest` just for
        // two listeners — see public/sw-push.js.
        importScripts: ["sw-push.js"],
        // The app shell/build assets only — never intercept the API. SSE at /api/events
        // in particular must pass through untouched (no response buffering, no timeout).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
        // A new deploy must take over immediately, not just for tabs opened after every
        // other tab closes: the new SW activates as soon as it's installed (skipWaiting)
        // and takes control of already-open clients right away (clientsClaim). Paired
        // with the `controllerchange` reload in main.tsx, a phone with the PWA already
        // open picks up a fresh build without a manual cache clear.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  server: {
    // Loopback only: the dev proxy forwards to a server that may run without a password.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "^/api/events": {
        target: devProxyServer,
        xfwd: true,
        // SSE requires no response buffering and no timeout.
        timeout: 0,
      },
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(rootDir, "src")}/`,
    },
  },
});
