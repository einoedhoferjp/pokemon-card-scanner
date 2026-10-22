// Lighthouse-Check der gebauten PWA.
//
// Ablauf: Build erzeugen -> `vite preview` starten -> Lighthouse (headless
// Chromium aus Playwright, damit kein zweiter Browser installiert werden muss)
// -> Punkte ausgeben -> Vorschau-Server beenden.
//
// Aufruf:  npm run lighthouse        (aus der Repo-Wurzel)
//           node scripts/lighthouse.mjs --open    (Report als HTML oeffnen)

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
// Lighthouse haengt bei mehreren Formaten `.report.<ext>` an den Pfad an.
const REPORT_BASE = path.join(webDir, "lighthouse-report");
const CATEGORIES = "performance,accessibility,best-practices,seo";

async function findReport(ext) {
  for (const candidate of [`${REPORT_BASE}.report.${ext}`, `${REPORT_BASE}.${ext}`]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* weiter suchen */
    }
  }
  throw new Error(`Lighthouse-Report (.${ext}) nicht gefunden`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} fehlgeschlagen (${result.status})`);
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* noch nicht da */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Vorschau-Server unter ${url} nicht erreichbar`);
}

console.log("→ Build erzeugen …");
run("npx", ["--yes", "vite", "build"], { cwd: webDir });

console.log(`→ Vorschau starten (Port ${PORT}) …`);
const preview = spawn(
  "npx",
  ["--yes", "vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { cwd: webDir, stdio: "ignore" },
);

try {
  await waitForServer(URL);
  console.log("→ Lighthouse laufen lassen (das dauert ~1 Minute) …");
  run(
    "npx",
    [
      "--yes",
      "lighthouse@12",
      URL,
      "--quiet",
      "--output=json",
      "--output=html",
      `--output-path=${REPORT_BASE}`,
      `--only-categories=${CATEGORIES}`,
      "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage",
    ],
    { cwd: webDir, env: { ...process.env, CHROME_PATH: chromium.executablePath() } },
  );

  const report = JSON.parse(await fs.readFile(await findReport("json"), "utf8"));
  console.log("\nPunkte:");
  for (const [key, category] of Object.entries(report.categories)) {
    console.log(`  ${key.padEnd(16)} ${Math.round((category.score ?? 0) * 100)}`);
  }
  const failed = Object.values(report.audits)
    .filter((a) => a.scoreDisplayMode === "binary" && a.score === 0)
    .map((a) => a.id);
  console.log(`  offene Prüfungen: ${failed.join(", ") || "keine"}`);

  const htmlReport = await findReport("html");
  console.log(`\nReport: ${path.relative(process.cwd(), htmlReport)}`);

  if (process.argv.includes("--open")) {
    run("npx", ["--yes", "open-cli", htmlReport], { cwd: webDir });
  }
} finally {
  preview.kill("SIGTERM");
}
