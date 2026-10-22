import "./env.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { buildApp } from "./app.js";
import { db } from "./db/client.js";
import { migrationsFolder } from "./db/migrations-path.js";
import { cleanupExpiredSessions } from "./auth/session.js";

const app = await buildApp();

// Migrationen beim Start (Containern starten ohne manuellen Schritt).
// In der Entwicklung bleibt das aus: MIGRATE_ON_START=1 explizit setzen.
if (process.env.MIGRATE_ON_START === "1") {
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
    app.log.info("Migrationen angewendet");
  } catch (err) {
    app.log.error({ err }, "Migrationen fehlgeschlagen");
    process.exit(1);
  }
}

// Abgelaufene Sitzungen beim Start aufraeumen (best effort).
try {
  await cleanupExpiredSessions();
} catch (err) {
  app.log.warn({ err }, "Sitzungsaufraeumen fehlgeschlagen");
}

const port = Number(process.env.API_PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });

// Sauber herunterfahren, damit Container einen SIGTERM schnell beenden.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
