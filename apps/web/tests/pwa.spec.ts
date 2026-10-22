import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PWA-/Offline-Tests.
 *
 * Der Build (`dist/`) wird vom zweiten `webServer` in `playwright.config.ts`
 * erzeugt (`vite build && vite preview --port 4173`); die Tests hier prüfen
 * diesen Build, den Service-Worker-Cache und das Verhalten ohne Netz.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "..", "dist");
const PREVIEW = "http://127.0.0.1:4173";

test.describe.configure({ mode: "serial" });

test("Build enthält Manifest, Icons, Service Worker und Workbox-Regeln", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(dist, "manifest.webmanifest"), "utf8"));
  expect(manifest.name).toContain("Scanner");
  expect(manifest.display).toBe("standalone");
  expect(manifest.lang).toBe("de");
  expect(manifest.icons?.length).toBeGreaterThanOrEqual(2);

  // Icons liegen wirklich vor
  for (const icon of manifest.icons) {
    const file = await fs.stat(path.join(dist, icon.src.replace(/^\//, "")));
    expect(file.size).toBeGreaterThan(100);
  }

  // Service-Worker + Registrierung entstehen
  expect((await fs.stat(path.join(dist, "sw.js"))).size).toBeGreaterThan(100);
  expect((await fs.stat(path.join(dist, "registerSW.js"))).size).toBeGreaterThan(10);

  // App-Shell vorab, Kartendaten/-bilder zur Laufzeit
  const sw = await fs.readFile(path.join(dist, "sw.js"), "utf8");
  expect(sw).toContain("precache");
  expect(sw).toContain("pcs-card-images");
  expect(sw).toContain("pcs-card-data");

  // index.html verweist auf Manifest und Titel
  const html = await fs.readFile(path.join(dist, "index.html"), "utf8");
  expect(html).toContain("Pokémon-Karten-Scanner");
  expect(html).toContain("manifest.webmanifest");
});

test("App-Shell startet ohne Netz (Service-Worker-Cache)", async ({ page, context }) => {
  await page.goto(`${PREVIEW}/`);
  await expect(page.getByRole("link", { name: "Karten-Scanner" })).toBeVisible();

  // Registrierung abwarten und sicherstellen, dass die Seite schon kontrolliert wird
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          navigator.serviceWorker.getRegistration().then((r) => r?.active != null),
        ),
      { timeout: 45_000 },
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null), {
      timeout: 45_000,
    })
    .toBe(true);

  // Precache ist gefüllt
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    let entries = 0;
    for (const name of names) {
      entries += (await (await caches.open(name)).keys()).length;
    }
    return { names, entries };
  });
  expect(cached.names.length, "mindestens ein Cache").toBeGreaterThan(0);
  expect(cached.entries, "Precache-Einträge").toBeGreaterThan(0);

  // Ohne Netz neu laden: App-Shell kommt aus dem Cache, Hinweis erscheint
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("link", { name: "Karten-Scanner" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await context.setOffline(false);
});

test("Ohne Netz sind Scannen und Galerie gesperrt", async ({ page, context }) => {
  await page.goto(`${PREVIEW}/`);
  await context.setOffline(true);
  // Offline-Zustand an den Client melden (Chromium feuert das Event beim Emulieren nicht immer)
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Foto aus Galerie wählen" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Aufnahme" })).toBeDisabled();
  await context.setOffline(false);
});

test("Installations-Hinweis erscheint, lässt sich ausführen und dauerhaft schließen", async ({
  page,
}) => {
  await page.goto("/");
  const banner = page.getByTestId("install-banner");

  const fireInstallEvent = () =>
    page.evaluate(() => {
      const event = new Event("beforeinstallprompt") as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      event.prompt = () => Promise.resolve();
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(event);
    });

  await fireInstallEvent();
  await expect(banner).toBeVisible();
  await page.getByTestId("install-action").click();
  await expect(banner).toBeHidden();

  // Nach dem Neuladen ist der Hinweis wieder da (noch nicht weggeklickt) …
  await page.reload();
  await fireInstallEvent();
  await expect(banner).toBeVisible();
  // … und lässt sich endgültig schließen
  await page.getByRole("button", { name: "Hinweis schließen" }).click();
  await expect(banner).toBeHidden();

  await page.reload();
  await fireInstallEvent();
  await expect(banner).toBeHidden();
});
