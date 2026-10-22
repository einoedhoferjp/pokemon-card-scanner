import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
export const db = drizzle(client, { schema });
export type Db = typeof db;

/** Verbindung schliessen (Tests/Skripte, damit der Prozess endet). */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 2 });
}
