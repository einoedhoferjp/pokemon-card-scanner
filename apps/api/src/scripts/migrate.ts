// Migrationen anwenden und beenden.
//
// Fuer das Deployment ohne laufenden API-Container:
//
//   docker compose run --rm --no-deps api node dist/scripts/migrate.js
//
// Im Container laeuft das normalerweise automatisch beim Start der API
// (MIGRATE_ON_START=1, siehe docker-compose.yml).

import "../env.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, db } from "../db/client.js";
import { migrationsFolder } from "../db/migrations-path.js";

const folder = migrationsFolder();
console.log(`Migrationen aus ${folder} …`);
await migrate(db, { migrationsFolder: folder });
console.log("Migrationen angewendet");
await closeDb();
