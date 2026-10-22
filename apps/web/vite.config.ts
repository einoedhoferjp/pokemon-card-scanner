import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pokémon-Karten-Scanner",
        short_name: "PK-Scan",
        description: "Pokémon-Sammelkarten mit Kamera scannen & sammeln",
        lang: "de",
        theme_color: "#030712",
        background_color: "#030712",
        display: "standalone",
        orientation: "portrait",
        categories: ["utilities", "photo", "games"],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // App-Shell vorab cachen: die App startet auch ohne Netz.
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Referenzbilder des Katalogs: selten geaendert, also aus dem Cache.
            urlPattern: ({ url, request }) =>
              request.destination === "image" && url.pathname.startsWith("/cards/"),
            handler: "CacheFirst",
            options: {
              cacheName: "pcs-card-images",
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 60 },
              // 0 = opake Antwort (anderer Origin ohne CORS) trotzdem cachen
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Kartendaten (Suche, Detail): erst Netz, sonst Cache. Nur Katalog,
            // niemals Konten/Scans/Sammlung - die gehoeren nicht in den Cache.
            urlPattern: ({ url, request }) =>
              request.method === "GET" && url.pathname.startsWith("/cards"),
            handler: "NetworkFirst",
            options: {
              cacheName: "pcs-card-data",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
