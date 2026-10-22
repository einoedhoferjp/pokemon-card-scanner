import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deployment-Test gegen eine echte HTTPS-Installation (Caddy + API + rec + DB).
 *
 * Laeuft nur mit gesetzter URL, sonst wird der Test uebersprungen:
 *
 *   PCS_DEPLOY_URL=https://localhost:8443 npx playwright test tests/deployment.spec.ts
 *
 * Der Test prueft genau die Dinge, die nur im Deployment schiefgehen:
 * Routing hinter dem Reverse-Proxy, HTTPS-Cookies (Sitzung + anonym) und dass
 * die gebaute PWA alle API-Aufrufe auf derselben Herkunft macht.
 */

const DEPLOY_URL = process.env.PCS_DEPLOY_URL;

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "fixtures", "scan-glurak.jpg");

// Eigene Zugangsdaten pro Lauf
const email = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const password = "geheim1234";

const API_PATH = /\/(cards|scans|collection|auth|health)([/?]|$)/;

test.skip(!DEPLOY_URL, "PCS_DEPLOY_URL nicht gesetzt – Deployment-Test uebersprungen");

// Eigene CA (PCS_TLS_MODE=internal): Zertifikat im Test nicht pruefen
test.use({ ignoreHTTPSErrors: true });

test.describe.configure({ mode: "serial" });

/** Alle API-Aufrufe der Seite, die NICHT auf der Deployment-Herkunft landen. */
function watchForeignApiCalls(page: import("@playwright/test").Page): string[] {
  const foreign: string[] = [];
  const origin = new URL(DEPLOY_URL!).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && API_PATH.test(url.pathname)) foreign.push(request.url());
  });
  return foreign;
}

test("Konto anlegen über HTTPS – API bleibt auf derselben Herkunft", async ({ page }) => {
  const foreign = watchForeignApiCalls(page);

  await page.goto(`${DEPLOY_URL}/anmelden`);
  await expect(page.getByRole("heading", { name: "Willkommen zurück" })).toBeVisible();

  await page.getByRole("button", { name: "Noch kein Konto? Registrieren" }).click();
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByLabel("Passwort wiederholen").fill(password);
  await page.getByRole("button", { name: "Registrieren" }).click();

  await expect(page.getByRole("heading", { name: "Meine Sammlung" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Noch keine Karten in der Sammlung.")).toBeVisible();

  // Neue Seite: die Sitzung liegt im Secure-Cookie und wird mitgeschickt
  await page.reload();
  await expect(page.getByRole("heading", { name: "Meine Sammlung" })).toBeVisible({
    timeout: 30_000,
  });

  expect(foreign, `API-Aufrufe ausserhalb von ${DEPLOY_URL}`).toEqual([]);
});

test("Scan läuft über den Proxy: Referenzbild und eigenes Foto werden geladen", async ({
  page,
}) => {
  const foreign = watchForeignApiCalls(page);

  await page.goto(`${DEPLOY_URL}/`);
  await expect(page.getByRole("link", { name: "Karten-Scanner" })).toBeVisible();
  await page.setInputFiles('input[type="file"]', FIXTURE);

  await expect(page.getByRole("heading", { name: "Ergebnis prüfen" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("Glurak").first()).toBeVisible();

  // Referenzbild aus dem Katalog (/cards/base1-4/image über den Proxy)
  const reference = page.locator('img[alt="Referenzkarte"]');
  await expect(reference).toBeVisible();
  await expect
    .poll(() => reference.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // Das hochgeladene Foto (/scans/<id>/image) beweist Proxy-Routing und Cookie
  const own = page.locator('img[alt="Dein Foto"]');
  await expect(own).toBeVisible();
  await expect
    .poll(() => own.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  expect(foreign, `API-Aufrufe ausserhalb von ${DEPLOY_URL}`).toEqual([]);
});
