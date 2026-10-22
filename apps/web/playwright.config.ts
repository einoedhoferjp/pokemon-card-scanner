import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright-Tests der Web-App (mobil).
 *
 * Voraussetzungen (laufende Dienste):
 *   - PostgreSQL (scripts/dev-db.py)
 *   - rec-Service  http://127.0.0.1:8000  (uvicorn app.main:app)
 *   - API          http://127.0.0.1:3000  (apps/api)
 * Der Vite-Dev-Server wird automatisch gestartet.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobil-chromium",
      use: {
        ...devices["Pixel 7"],
        locale: "de-DE",
        // Kamera simulieren (Die Erkennung selbst läuft über den Server.)
        permissions: ["camera"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
      },
    },
  ],
  webServer: [
    {
      command: "npx --yes vite --host 127.0.0.1 --port 5173",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    // Beim Deployment-Test (PCS_DEPLOY_URL gesetzt) darf der Build NICHT
    // laufen: dort wird die bereits gebaute Produktionsversion
    // (VITE_API_URL=same-origin) vom Caddy ausgeliefert. Ein Neubau wuerde
    // sie ueberschreiben und die API laege plötzlich wieder auf :3000.
    ...(process.env.PCS_DEPLOY_URL
      ? []
      : [
          {
            // Gebaute App (dist) für die PWA-/Offline-Tests: Service Worker,
            // App-Shell-Cache und Installations-Hinweis gibt es nur im Build.
            command:
              "npx --yes vite build && npx --yes vite preview --host 127.0.0.1 --port 4173 --strictPort",
            url: "http://127.0.0.1:4173",
            reuseExistingServer: true,
            timeout: 240_000,
          },
        ]),
  ],
});
