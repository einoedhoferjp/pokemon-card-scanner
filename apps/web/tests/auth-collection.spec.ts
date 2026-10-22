import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mobil-Tests für Anmeldung und Sammlung (echte API + DB erforderlich).
 *
 * Ablauf: Konto anlegen -> Karte scannen und bestätigen -> in der Sammlung
 * prüfen -> Menge/Zustand ändern -> abmelden -> erneut anmelden und
 * sicherstellen, dass die Sammlung erhalten bleibt.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "fixtures", "scan-glurak.jpg");

test.describe.configure({ mode: "serial" });

// Eigene Zugangsdaten pro Lauf, damit die Sammlung nicht von alten Daten verfälscht wird.
const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const password = "geheim1234";

/** Anmelden und warten, bis wir auf der Scan-Seite sind (Datei-Eingabe ist da). */
async function signIn(page: Page) {
  await page.goto("/anmelden");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 20_000 });
}

test("Konto anlegen führt zur (leeren) Sammlung, Abmelden sperrt sie", async ({ page }) => {
  await page.goto("/anmelden");
  await expect(page.getByRole("heading", { name: "Willkommen zurück" })).toBeVisible();

  await page.getByRole("button", { name: "Noch kein Konto? Registrieren" }).click();
  await expect(page.getByRole("heading", { name: "Konto anlegen" })).toBeVisible();

  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Anzeigename (optional)").fill("E2E");
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByLabel("Passwort wiederholen").fill(password);
  await page.getByRole("button", { name: "Registrieren" }).click();

  await expect(page.getByRole("heading", { name: "Meine Sammlung" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Noch keine Karten in der Sammlung.")).toBeVisible();

  // Abmelden ist möglich, danach ist die Sammlung gesperrt
  await page.getByRole("button", { name: "Abmelden" }).click();
  // Abwarten, dass die Abmeldung durch ist (sonst überholt die Umleitung den Klick)
  await expect(page.getByRole("button", { name: "Foto aus Galerie wählen" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("link", { name: "Sammlung" }).click();
  await expect(page.getByText("Bitte anmelden, um deine Sammlung zu sehen.")).toBeVisible({
    timeout: 20_000,
  });
});

test("Anmelden, Karte scannen, bestätigen – Karte liegt in der Sammlung", async ({ page }) => {
  await signIn(page);

  // Scan wie im normalen Flow
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("heading", { name: "Ergebnis prüfen" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Passt so" }).click();
  await expect(page.getByText("Gespeichert", { exact: false })).toBeVisible({ timeout: 30_000 });

  // Hinweis: Karte ist in der Sammlung
  await expect(page.getByText("Zur Sammlung hinzugefügt", { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // Sammlung öffnen
  await page.getByRole("link", { name: "Sammlung" }).click();
  await expect(page.getByRole("heading", { name: "Meine Sammlung" })).toBeVisible();

  const item = page.getByTestId("collection-item").first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  await expect(item.getByText("Glurak")).toBeVisible();
  await expect(item.getByTestId("quantity")).toHaveText("1");
});

test("Menge und Zustand ändern, bleibt nach Neuladen erhalten", async ({ page }) => {
  await signIn(page);
  await page.goto("/sammlung");

  const item = page.getByTestId("collection-item").first();
  await expect(item.getByTestId("quantity")).toHaveText("1", { timeout: 20_000 });

  await item.getByRole("button", { name: "Mehr" }).click();
  await expect(item.getByTestId("quantity")).toHaveText("2", { timeout: 20_000 });

  await item.getByTestId("condition").selectOption("mint");
  await expect(item.getByTestId("condition")).toHaveValue("mint", { timeout: 20_000 });

  // Überblick zeigt die Summe
  await expect(page.getByText("Karten insgesamt")).toBeVisible();

  await page.reload();
  const reloaded = page.getByTestId("collection-item").first();
  await expect(reloaded.getByTestId("quantity")).toHaveText("2", { timeout: 20_000 });
  await expect(reloaded.getByTestId("condition")).toHaveValue("mint");
});

test("Karte manuell hinzufügen und wieder entfernen", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page);
  await page.goto("/sammlung");

  // Auf das Laden der Liste warten, sonst zählen wir 0
  const items = page.getByTestId("collection-item");
  await expect(items.first()).toBeVisible({ timeout: 20_000 });
  const before = await items.count();

  await page.getByRole("button", { name: "Karte hinzufügen" }).click();
  await page.getByPlaceholder(/Name oder Nummer/).fill("Pikachu");

  // Erster Suchtreffer (die genaue Karte ist hier egal – es geht um den Weg)
  const hit = page.getByTestId("search-result").first();
  await expect(hit).toBeVisible({ timeout: 30_000 });
  await hit.click();

  await expect(page.getByTestId("collection-item")).toHaveCount(before + 1, { timeout: 20_000 });
  await expect(page.getByText("Zur Sammlung hinzugefügt", { exact: false })).toBeVisible();

  // Neueste Karte steht oben (Sortierung nach letzter Änderung) -> entfernen
  await page
    .getByTestId("collection-item")
    .first()
    .getByRole("button", { name: "Entfernen" })
    .click();
  await expect(page.getByTestId("collection-item")).toHaveCount(before, { timeout: 20_000 });
});

test("Kartendetail zeigt Referenzbild und Bestand", async ({ page }) => {
  await signIn(page);
  await page.goto("/karte/base1-4");

  await expect(page.getByRole("heading", { name: "Glurak" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("in der Sammlung", { exact: false })).toBeVisible();

  const img = page.locator("img").first();
  const loaded = await img.evaluate(
    (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
  );
  expect(loaded, "Referenzbild muss geladen sein").toBe(true);
});
