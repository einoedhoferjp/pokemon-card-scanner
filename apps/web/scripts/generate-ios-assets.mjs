// Erzeugt App-Icon und Startbildschirm (Launch Screen) der iOS-App aus
// demselben Motiv wie die PWA-Icons.
//
// Aufruf (aus apps/web):  node scripts/generate-ios-assets.mjs
// Voraussetzung: das Verzeichnis apps/web/ios (Capacitor-Projekt) existiert und
// `sharp` ist erreichbar.
//
// Das Xcode-Projekt ist so eingestellt, dass es genau ein 1024er-Icon
// ("universal", platform ios) und drei Splash-Groessen nutzt - iOS skaliert
// selbst. Deshalb reicht es, diese vier Dateien zu ersetzen.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { iconSvg, SPLASH_BG } from "./icon-svg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let sharp;
for (const candidate of ["sharp", "../../api/node_modules/sharp", "../node_modules/sharp"]) {
  try {
    sharp = require(candidate);
    break;
  } catch {
    /* weiter probieren */
  }
}
if (!sharp) {
  console.error("sharp nicht gefunden – bitte `pnpm install` im Repo-Root ausführen.");
  process.exit(1);
}

const assetsDir = path.resolve(here, "..", "ios", "App", "App", "Assets.xcassets");
if (!existsSync(assetsDir)) {
  console.error(
    "apps/web/ios fehlt. Das Capacitor-Projekt anlegen (siehe IOS.md) und erneut ausführen.",
  );
  process.exit(1);
}

// App-Icon: 1024×1024, deckendes Quadrat. iOS rundet die Ecken selbst; ein
// bereits gerundetes PNG würde an den Ecken durchscheinen.
const appIcon = await sharp(Buffer.from(iconSvg(1024, { rounded: false })))
  // flatten entfernt den Alphakanal: iOS erwartet ein deckendes Icon.
  .flatten({ background: SPLASH_BG })
  .png({ compressionLevel: 9 })
  .toBuffer();
const appIconFile = path.join(assetsDir, "AppIcon.appiconset", "AppIcon-512@2x.png");
await writeFile(appIconFile, appIcon);
console.log(`AppIcon-512@2x.png (1024×1024, ${appIcon.length} B)`);

// Startbildschirm: dunkler Grund, Icon mittig. Die drei Dateien sind laut
// Contents.json 1x/2x/3x, haben im Template aber dieselbe Pixelgroesse.
const iconSize = 760;
const splashIcon = await sharp(Buffer.from(iconSvg(iconSize, { rounded: true })))
  .png({ compressionLevel: 9 })
  .toBuffer();

for (const file of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  const splash = await sharp({
    create: {
      width: 2732,
      height: 2732,
      channels: 4,
      background: SPLASH_BG,
    },
  })
    .composite([{ input: splashIcon, gravity: "center" }])
    .flatten({ background: SPLASH_BG })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(assetsDir, "Splash.imageset", file), splash);
  console.log(`${file} (2732×2732, ${splash.length} B)`);
}

// Fehlerseite: Die Seite liegt lokal in der App (server.errorPath) und wird
// angezeigt, wenn der Server nicht erreichbar ist. Damit "Erneut versuchen"
// direkt zum Server fuehrt, wird die beim Build gesetzte Adresse eingesetzt.
const offlineFile = path.resolve(here, "..", "ios", "App", "App", "public", "offline.html");
const appUrl = process.env.PCS_APP_URL?.trim();
if (!existsSync(offlineFile)) {
  console.warn("offline.html fehlt – bitte zuerst `npx cap sync ios` ausfuehren.");
} else if (appUrl?.startsWith("https://")) {
  const html = await readFile(offlineFile, "utf8");
  await writeFile(offlineFile, html.replaceAll("__PCS_APP_URL__", appUrl));
  console.log(`offline.html: Server-Adresse ${appUrl} eingesetzt`);
} else {
  console.warn(
    "offline.html: PCS_APP_URL fehlt – die Fehlerseite zeigt nur den allgemeinen Hinweis.",
  );
}
