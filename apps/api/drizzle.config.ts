// Drizzle-Kit-Konfiguration. Laedt die .env aus der Repo-Wurzel, damit
// `npx drizzle-kit generate|migrate` ohne vorheriges `source .env` funktioniert.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
