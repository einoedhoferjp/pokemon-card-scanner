// Erzeugt die PWA-/Favicon-Icons (SVG -> PNG) im Ordner public/.
//
// Aufruf (aus apps/web):  node scripts/generate-icons.mjs
// Voraussetzung: das Paket `sharp` ist erreichbar (liegt in apps/api/node_modules
// bzw. im Workspace-Root). Ohne sharp bricht das Skript mit Hinweis ab.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { iconSvg } from "./icon-svg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "public");
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

const targets = [
  { file: "pwa-192x192.png", size: 192 },
  { file: "pwa-512x512.png", size: 512 },
  { file: "pwa-maskable-512x512.png", size: 512, rounded: false, inset: 0.72 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "favicon-32.png", size: 32 },
];

await mkdir(publicDir, { recursive: true });
for (const { file, size, rounded = true, inset = 1 } of targets) {
  const png = await sharp(Buffer.from(iconSvg(size, { rounded, inset })))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(publicDir, file), png);
  console.log(`${file} (${size}×${size}, ${png.length} B)`);
}
