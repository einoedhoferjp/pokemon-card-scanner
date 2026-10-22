// Karten-Endpunkte: Suche (manueller Fallback), Detail, Referenzbild.

import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { CardSummary } from "@shared/types";
import { db } from "../db/client.js";
import { cards, sets } from "../db/schema.js";
import { readReferenceImage } from "../lib/images.js";

type CardRow = {
  tcgdexId: string;
  nameDe: string | null;
  nameEn: string | null;
  number: string;
  rarity: string | null;
  localImagePath: string | null;
  setId: string;
  setName: string | null;
};

function toSummary(row: CardRow): CardSummary {
  const hasImage = Boolean(row.localImagePath);
  return {
    tcgdexId: row.tcgdexId,
    nameDe: row.nameDe,
    nameEn: row.nameEn,
    number: row.number,
    setId: row.setId,
    setName: row.setName,
    rarity: row.rarity,
    hasImage,
    imageUrl: hasImage ? `/cards/${encodeURIComponent(row.tcgdexId)}/image` : null,
  };
}

const baseSelect = {
  tcgdexId: cards.tcgdexId,
  nameDe: cards.nameDe,
  nameEn: cards.nameEn,
  number: cards.number,
  rarity: cards.rarity,
  localImagePath: cards.localImagePath,
  setId: sets.tcgdexId,
  setName: sets.nameDe,
};

export async function cardRoutes(app: FastifyInstance) {
  // Manuelle Suche: Name (de/en) oder Nummer, optional auf ein Set begrenzt.
  app.get<{ Querystring: { q?: string; set?: string; limit?: string } }>(
    "/cards/search",
    async (req) => {
      const q = (req.query.q ?? "").trim();
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50);
      if (q.length < 2) return { results: [] as CardSummary[] };
      // Obergrenze: ungegrenzte Suchbegriffe machen die ILIKE-Suche teuer.
      if (q.length > 100) return { results: [] as CardSummary[] };

      const needle = `%${q}%`;
      const conds = [
        or(
          ilike(cards.nameDe, needle),
          ilike(cards.nameEn, needle),
          eq(cards.number, q),
          sql`${cards.number} ILIKE ${needle}`,
        )!,
      ];
      if (req.query.set) conds.push(eq(sets.tcgdexId, req.query.set));

      // Relevanz: exakter Name zuerst, dann exakte Nummer, dann neueste Sets
      const rows = await db
        .select(baseSelect)
        .from(cards)
        .innerJoin(sets, eq(cards.setId, sets.id))
        .where(and(...conds))
        .orderBy(
          sql`CASE WHEN lower(coalesce(${cards.nameDe}, '')) = lower(${q})
                  OR lower(coalesce(${cards.nameEn}, '')) = lower(${q}) THEN 0 ELSE 1 END`,
          sql`CASE WHEN ${cards.number} = ${q} THEN 0 ELSE 1 END`,
          desc(sets.releaseDate),
          asc(cards.number),
        )
        .limit(limit);

      return { results: rows.map(toSummary) };
    },
  );

  app.get<{ Params: { tcgdexId: string } }>("/cards/:tcgdexId", async (req, reply) => {
    const rows = await db
      .select(baseSelect)
      .from(cards)
      .innerJoin(sets, eq(cards.setId, sets.id))
      .where(eq(cards.tcgdexId, req.params.tcgdexId))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "Karte nicht gefunden" });
    return toSummary(rows[0]);
  });

  // Referenzbild aus dem lokalen Cache (nur echte Bilder, keine HTML-Fehler).
  app.get<{ Params: { tcgdexId: string } }>("/cards/:tcgdexId/image", async (req, reply) => {
    const buf = await readReferenceImage(req.params.tcgdexId);
    if (!buf) return reply.code(404).send({ error: "Kein Referenzbild" });
    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(buf);
  });
}
