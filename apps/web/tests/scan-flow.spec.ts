import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mobil-Tests des Scan-Flows (echte API + rec-Service erforderlich).
 *
 * Getestet wird der komplette Weg: Foto hochladen -> Erkennung -> Kandidat mit
 * Referenzbild prüfen -> bestätigen -> Verlauf -> löschen.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "fixtures", "scan-glurak.jpg");

test.describe.configure({ mode: "serial" });

test("Scan-Seite lädt mit Kamera oder Galerie-Fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Karten-Scanner" })).toBeVisible();

  // Galerie-Fallback ist immer da (auch ohne Kamera/HTTPS nutzbar)
  const gallery = page.getByRole("button", { name: "Foto aus Galerie wählen" });
  await expect(gallery).toBeVisible();

  // Mit (simulierter) Kamera wird zusätzlich der Auslöser gezeigt
  const capture = page.getByRole("button", { name: "Aufnahme" });
  if (await capture.count()) await expect(capture).toBeVisible();

  // Sprachumschaltung (Deutsch <-> Englisch)
  await page.getByRole("button", { name: "Sprache: en" }).click();
  await expect(page.getByRole("link", { name: "Card Scanner" })).toBeVisible();
  await page.getByRole("button", { name: "Language: de" }).click();
  await expect(page.getByRole("link", { name: "Karten-Scanner" })).toBeVisible();
});

test("Foto hochladen: Kandidat mit Referenzbild, dann bestätigen", async ({ page }) => {
  await page.goto("/");

  await page.setInputFiles('input[type="file"]', FIXTURE);

  // Wir landen auf der Ergebnis-Seite
  await expect(page.getByRole("heading", { name: "Ergebnis prüfen" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Dein Foto")).toBeVisible();

  // Top-1 ist Glurak (base1-4) und das Referenzbild wird geladen
  const candidates = page.getByRole("heading", { name: "Kandidaten" }).locator("..");
  await expect(candidates.getByText("Glurak").first()).toBeVisible();

  const reference = page.locator('img[alt="Referenzkarte"]');
  await expect(reference).toBeVisible();
  const loaded = await reference.evaluate(
    (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
  );
  expect(loaded, "Referenzbild muss tatsächlich geladen sein").toBe(true);

  // Technische Details sind einsehbar (Transparenz)
  await page.getByText("Technische Details").click();
  await expect(page.getByText("Begründung")).toBeVisible();

  // Bestätigen
  await page.getByRole("button", { name: "Passt so" }).click();
  await expect(page.getByText("Gespeichert", { exact: false })).toBeVisible({ timeout: 30_000 });
});

test("manuelle Suche findet Karten (Fallback, wenn die Erkennung daneben liegt)", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("heading", { name: "Ergebnis prüfen" })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Andere Karte" }).click();
  const input = page.getByPlaceholder(/Name oder Nummer/);
  await expect(input).toBeVisible();
  await input.fill("Glurak");

  // Trefferliste der manuellen Suche
  await expect(page.getByText("Glurak", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  const options = page.locator('button:has-text("base1-4")').first();
  await expect(options).toBeVisible({ timeout: 30_000 });
});

test("Verlauf zeigt den eigenen Scan und kann löschen (DSGVO)", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());

  // Verlauf ist an den Browser gebunden – daher erst einen Scan anlegen.
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("heading", { name: "Ergebnis prüfen" })).toBeVisible({
    timeout: 60_000,
  });

  await page.goto("/verlauf");
  await expect(page.getByRole("heading", { name: "Verlauf" })).toBeVisible();

  const entries = page.locator("li");
  const before = await entries.count();
  expect(before, "mindestens ein Scan aus diesem Browser").toBeGreaterThan(0);

  // Ersten Eintrag löschen
  await page.getByRole("button", { name: "Löschen" }).first().click();
  await expect.poll(async () => entries.count(), { timeout: 20_000 }).toBeLessThan(before);
});
