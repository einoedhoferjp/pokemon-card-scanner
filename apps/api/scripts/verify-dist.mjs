// Prueft den Build fuer den Produktionsstart unter reinem Node.
//
// Im Betrieb laeuft die API ohne tsx (`node dist/main.js`). Laufzeit-Importe aus
// dem Workspace-Paket @shared/types (TypeScript-Quellen) wuerden dort
// fehlschlagen; `import type` ist in Ordnung, weil tsc diese entfernt.
// Dieser Check laesst den Build deshalb absichtlich scheitern.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "..", "dist");

async function* jsFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith(".js")) yield full;
  }
}

const pattern = /(?:import|export)[^;]*from\s*["']@shared\/|require\(\s*["']@shared\//;
const offenders = [];

for await (const file of jsFiles(dist)) {
  if (pattern.test(await readFile(file, "utf8"))) offenders.push(path.relative(dist, file));
}

if (offenders.length > 0) {
  console.error(
    "Build enthaelt Laufzeit-Importe aus @shared/types – unter reinem Node nicht ladbar:",
  );
  for (const file of offenders) console.error(`  - ${file}`);
  console.error("Bitte `import type` verwenden oder den Wert lokal definieren.");
  process.exit(1);
}

console.log("dist geprueft: keine Laufzeit-Importe aus @shared/types");
