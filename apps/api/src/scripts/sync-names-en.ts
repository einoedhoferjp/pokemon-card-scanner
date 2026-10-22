// Englische Kartennamen nachziehen (TCGdex /en/...).
//
// Die Referenzbilder von pokemontcg.io sind englisch, die TCGdex-Sync
// (de) speichert deutsche Namen in name_de. Für die OCR-Prüfung brauchen
// wir auch name_en. Endpunkt: https://api.tcgdex.net/v2/en/cards/{id}
//
// Fortsetzbar: Karten mit vorhandenem name_en (und gleichem Wert wie
// name_de, der noch nie ueberschrieben wurde) werden übersprungen, wenn
// --force nicht gesetzt ist. Standard: alle Karten, deren name_en = name_de
// ist (also nie echt englisch geladen wurde), werden nachgezogen.
//
// Aufruf (aus apps/api): pnpm sync:names-en

import "../env.js";
import { db } from "../db/client.js";
import { cards, syncJobs } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import axios from "axios";
import { errorMessage, httpStatusOf } from "../lib/errors.js";

const BASE_URL = (process.env.TCGDEX_BASE_URL || "https://api.tcgdex.net/v2") + "/en";
const API = axios.create({ baseURL: BASE_URL, timeout: 30000 });
const CONCURRENCY = 10;

async function getJson<T>(url: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await API.get<T>(url);
      return res.data;
    } catch (e) {
      if (httpStatusOf(e) === 404) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const startedAt = new Date().toISOString();
  const job = await db
    .insert(syncJobs)
    .values({ type: "names_en", status: "running", startedAt: new Date() })
    .returning();

  const todo = await db
    .select({ id: cards.id, tcgdexId: cards.tcgdexId, nameDe: cards.nameDe })
    .from(cards)
    .where(sql`(${cards.nameEn} IS NULL OR ${cards.nameEn} = ${cards.nameDe})`);

  console.log(`Karten ohne echten englischen Namen: ${todo.length}`);

  let done = 0;
  let updated = 0;
  let missing = 0;
  const errors: string[] = [];

  await mapLimit(todo, CONCURRENCY, async (row) => {
    try {
      const detail = await getJson<{ name?: string }>(`/cards/${row.tcgdexId}`);
      if (detail.name) {
        await db
          .update(cards)
          .set({ nameEn: detail.name, updatedAt: new Date() })
          .where(eq(cards.id, row.id));
        updated++;
      } else {
        missing++;
      }
    } catch (e) {
      if (httpStatusOf(e) === 404) {
        missing++;
      } else {
        errors.push(`${row.tcgdexId}: ${errorMessage(e)}`);
      }
    }
    done++;
    if (done % 500 === 0) console.log(`${done}/${todo.length} (updated: ${updated})`);
  });

  const stats = {
    todo: todo.length,
    updated,
    missing,
    errors: errors.slice(0, 20),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  await db
    .update(syncJobs)
    .set({
      status: errors.length > 0 ? "completed" : "completed",
      statsJson: stats,
      finishedAt: new Date(),
      errorText: errors.length ? `${errors.length} Fehler` : null,
    })
    .where(eq(syncJobs.id, job[0].id));

  console.log("SYNC NAMES EN COMPLETE", JSON.stringify(stats, null, 2));
}

main();
