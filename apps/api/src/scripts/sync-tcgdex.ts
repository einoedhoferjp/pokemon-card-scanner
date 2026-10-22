// TCGdex-Full-Sync: Sets + Karten inkl. Referenzbildern.
//
// TCGdex v2 liefert in Listen-Endpunkten nur Kurzobjekte (id/localId/name).
// Set-Zuordnung kommt aus /sets/{id}, Detailfelder aus /cards/{id}.
//
// Bildquellen (Fallback-Kette, alle mit Magic-Byte-Prüfung):
//   1. TCGdex `image` (kann derzeit HTML-Fehlerseiten liefern → wird verworfen)
//   2. pokemontcg.io `https://images.pokemontcg.io/{setId}/{nummer}_hires.png`
//      (Set-Kürzel stimmen bei den meisten Sets überein; Nummer ohne führende Nullen)
//   3. sonst kein Bild (Karte wird trotzdem gespeichert)
//
// Robustheit: begrenzte Parallelität, Wiederholungen, Überspringen bereits
// vorhandener Karten – ein Abbruch ist fortsetzbar; Karten ohne Bild werden
// beim nächsten Lauf nachgezogen.

import "../env.js";
import fs from "fs/promises";
import path from "path";
import { db } from "../db/client.js";
import { sets, cards, syncJobs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import axios from "axios";
import sharp from "sharp";
import type { SyncStats } from "@shared/types";
import { errorMessage } from "../lib/errors.js";

const REF_CACHE_DIR = process.env.REF_CACHE_DIR || "./data/ref_cache";
const LANG = process.env.TCGDEX_LANG || "de";
const BASE_URL = (process.env.TCGDEX_BASE_URL || "https://api.tcgdex.net/v2") + "/" + LANG;
const API = axios.create({ baseURL: BASE_URL, timeout: 30000 });
const CONCURRENCY = 10;

type SetListEntry = {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  logo?: string;
  symbol?: string;
};

type SetDetail = SetListEntry & {
  serie?: { id: string; name: string };
  cards?: Array<{ id: string; localId: string; name: string }>;
};

type CardDetail = {
  id: string;
  localId: string;
  name: string;
  hp?: string;
  rarity?: string;
  illustrator?: string;
  regulationMark?: string;
  types?: string[];
  image?: string;
  category?: string;
  variants?: Record<string, boolean>;
};

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function getJson<T>(url: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await API.get<T>(url);
      return res.data;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 16) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // WEBP (RIFF....WEBP)
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return true;
  // GIF (selten, tolerieren)
  if (buf.subarray(0, 3).toString("latin1") === "GIF") return true;
  return false;
}

// Set-ID-Varianten: TCGdex nutzt z. B. "sv01"/"sv03.5", pokemontcg.io "sv1"/"sv3pt5".
function setVariants(setId: string): string[] {
  const out = new Set<string>([setId]);
  const stripped = setId.replace(/0+(\d)/g, "$1");
  out.add(stripped);
  if (setId.includes(".")) {
    // sv03.5 -> sv3pt5
    const pt = stripped.replace(/(\d)\.(\d)/, (_m, d1, d2) => `${d1}pt${d2}`);
    out.add(pt);
    out.add(pt.replace(/pt0+(\d)/, "pt$1"));
  }
  return [...out];
}

function imageCandidates(setId: string, localId: string, tcgdexImage?: string): string[] {
  const num = String(localId).replace(/^0+(?=\d)/, "");
  const urls: string[] = [];
  if (tcgdexImage) {
    urls.push(tcgdexImage);
  }
  for (const variant of setVariants(setId)) {
    urls.push(`https://images.pokemontcg.io/${variant}/${num}_hires.png`);
    urls.push(`https://images.pokemontcg.io/${variant}/${num}.png`);
  }
  return urls;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "User-Agent": "pokemon-card-scanner/0.1 (+local dev)" },
        validateStatus: (s) => s === 200,
      });
      const buf = Buffer.from(res.data);
      if (looksLikeImage(buf)) return buf;
      return null; // HTML-Fehlerseite o. Ä. -> keine Wiederholung nötig
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
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

async function downloadBestImage(
  setId: string,
  localId: string,
  tcgdexImage: string | undefined,
  destBase: string,
): Promise<string | null> {
  for (const url of imageCandidates(setId, localId, tcgdexImage)) {
    const buf = await fetchImage(url);
    if (buf) {
      const dest = `${destBase}.jpg`;
      await sharp(buf).jpeg({ quality: 88 }).toFile(dest);
      return path.basename(dest);
    }
  }
  return null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const job = await db
    .insert(syncJobs)
    .values({
      type: "tcgdex_full",
      status: "running",
      statsJson: { startedAt },
      startedAt: new Date(),
    })
    .returning();

  const stats: SyncStats = {
    setsFetched: 0,
    cardsFetched: 0,
    setsUpserted: 0,
    cardsUpserted: 0,
    imagesDownloaded: 0,
    imagesSkipped: 0,
    errors: [],
    startedAt,
  };

  try {
    await ensureDir(REF_CACHE_DIR);
    await ensureDir(path.join(REF_CACHE_DIR, "cards"));

    // 1) Sets
    const setList = await getJson<SetListEntry[]>("/sets");
    stats.setsFetched = setList.length;
    console.log(`Sets geladen: ${setList.length}`);

    const setIds = new Map<string, string>(); // tcgdexId -> uuid
    for (const s of setList) {
      const existing = await db.select().from(sets).where(eq(sets.tcgdexId, s.id)).limit(1);
      if (existing.length === 0) {
        const inserted = await db
          .insert(sets)
          .values({
            tcgdexId: s.id,
            nameDe: s.name,
            nameEn: s.name,
            series: s.series,
            releaseDate: s.releaseDate,
            logoUrl: s.logo,
          })
          .returning();
        setIds.set(s.id, inserted[0].id);
        stats.setsUpserted++;
      } else {
        setIds.set(s.id, existing[0].id);
      }
    }

    // 2) Karten-IDs je Set (Set-Zuordnung aus Set-Detail)
    const cardRefs: Array<{ setId: string; cardId: string; localId: string }> = [];
    let setIdx = 0;
    for (const s of setList) {
      setIdx++;
      try {
        const detail = await getJson<SetDetail>(`/sets/${s.id}`);
        for (const c of detail.cards ?? []) {
          cardRefs.push({ setId: s.id, cardId: c.id, localId: c.localId });
        }
      } catch (e) {
        stats.errors.push(`Set-Detail ${s.id}: ${errorMessage(e)}`);
      }
      if (setIdx % 50 === 0) {
        console.log(`Set-Details: ${setIdx}/${setList.length} (Karten bisher: ${cardRefs.length})`);
      }
    }
    stats.cardsFetched = cardRefs.length;
    console.log(`Kartenreferenzen gesamt: ${cardRefs.length}`);

    // 3) Karten parallel: neue anlegen, vorhandene ohne Bild nachziehen
    let done = 0;
    let imagesMissing = 0;
    await mapLimit(cardRefs, CONCURRENCY, async ({ setId, cardId, localId }) => {
      try {
        const uuid = setIds.get(setId);
        if (!uuid) {
          stats.errors.push(`Set-uuid fehlt für ${cardId} (${setId})`);
          return;
        }

        const existing = await db.select().from(cards).where(eq(cards.tcgdexId, cardId)).limit(1);
        const destBase = path.join(REF_CACHE_DIR, "cards", cardId);

        if (existing.length > 0) {
          const row = existing[0];
          if (!row.localImagePath) {
            const detail = await getJson<CardDetail>(`/cards/${cardId}`);
            const fname = await downloadBestImage(setId, localId, detail.image, destBase);
            if (fname) {
              await db
                .update(cards)
                .set({ localImagePath: `cards/${fname}`, updatedAt: new Date() })
                .where(eq(cards.id, row.id));
              stats.imagesDownloaded++;
            } else {
              imagesMissing++;
            }
          }
          done++;
          return;
        }

        const detail = await getJson<CardDetail>(`/cards/${cardId}`);
        let localImagePath: string | null = null;
        const fname = await downloadBestImage(setId, localId, detail.image, destBase);
        if (fname) {
          localImagePath = `cards/${fname}`;
          stats.imagesDownloaded++;
        } else {
          stats.imagesSkipped++;
          imagesMissing++;
        }

        await db.insert(cards).values({
          tcgdexId: cardId,
          setId: uuid,
          number: localId,
          nameDe: detail.name,
          nameEn: detail.name,
          hp: detail.hp,
          rarity: detail.rarity,
          types: detail.types || [],
          illustrator: detail.illustrator,
          regulationMark: detail.regulationMark,
          variantsKnown: [],
          languageHint: LANG,
          imageUrl: detail.image,
          localImagePath,
          hasHolo: Boolean(detail.variants?.holo),
        });
        stats.cardsUpserted++;
        done++;
        if (done % 500 === 0) {
          console.log(
            `Karten: ${done}/${cardRefs.length} | bilder: ${stats.imagesDownloaded} | ohne bild: ${imagesMissing}`,
          );
        }
      } catch (e) {
        stats.errors.push(`Karte ${cardId}: ${errorMessage(e)}`);
      }
    });

    stats.finishedAt = new Date().toISOString();
    await db
      .update(syncJobs)
      .set({ status: "completed", statsJson: stats, finishedAt: new Date() })
      .where(eq(syncJobs.id, job[0].id));

    console.log(
      "SYNC COMPLETE",
      JSON.stringify({ ...stats, errors: stats.errors.slice(0, 20) }, null, 2),
    );
  } catch (e) {
    stats.finishedAt = new Date().toISOString();
    stats.errors.push(errorMessage(e));
    await db
      .update(syncJobs)
      .set({
        status: "failed",
        statsJson: stats,
        errorText: errorMessage(e),
        finishedAt: new Date(),
      })
      .where(eq(syncJobs.id, job[0].id));
    console.error("SYNC FAILED", e);
    process.exit(1);
  }
}

main();
