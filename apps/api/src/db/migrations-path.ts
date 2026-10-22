// Findet den Migrationsordner.
//
// Im Container liegen die .sql-Dateien neben dem gebauten JS
// (`dist/db/migrations`), in der Entwicklung direkt in `src/db/migrations`.
// Da diese Datei in beiden Faellen im Ordner `db` liegt, passt `migrations`.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "migrations"),
    path.join(here, "..", "..", "src", "db", "migrations"),
  ];
  const found = candidates.find((dir) => existsSync(path.join(dir, "meta", "_journal.json")));
  if (!found) {
    throw new Error(`Migrationsordner nicht gefunden (gesucht: ${candidates.join(", ")})`);
  }
  return found;
}
