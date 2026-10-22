// Laedt die Umgebungsvariablen aus der Repo-Root-.env (unabhaengig vom cwd).
//
// Reihenfolge: Root-.env zuerst, danach eine evtl. vorhandene apps/api/.env
// (deren Werte gewinnen). Bereits gesetzte Prozess-Variablen bleiben erhalten.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

config({ path: path.join(repoRoot, ".env") });
config(); // optionale lokale Datei (apps/api/.env) bzw. cwd
