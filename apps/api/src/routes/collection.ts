// Sammlung pro Nutzer: anlegen, auflisten, aendern, loeschen, Statistik.
//
// Regeln:
//   - Alles erfordert Anmeldung (401 sonst).
//   - Ein Eintrag je (Nutzer, Karte, Zustand). Erneutes Hinzufuegen erhoeht die
//     Menge; aendert man den Zustand auf einen bereits vorhandenen, werden die
//     Eintraege zusammengefuehrt.
//   - Nach aussen gehen TCGdex-IDs, keine DB-UUIDs (ausser der Eintrags-ID).

import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { CollectionStats } from "@shared/types";
import { db } from "../db/client.js";
import { cards, collectionItems, sets } from "../db/schema.js";
import { requireUser } from "../auth/plugin.js";
import {
  addToCollection,
  CARD_CONDITIONS,
  itemSelect,
  loadItem,
  sanitizeCondition,
  sanitizeQuantity,
  sanitizeText,
  toItem,
  type ItemRow,
} from "../lib/collection.js";

const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

export async function collectionRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      cardId?: unknown;
      quantity?: unknown;
      condition?: unknown;
      language?: unknown;
      notes?: unknown;
    };
  }>("/collection", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const cardId = typeof req.body?.cardId === "string" ? req.body.cardId : "";
    if (!cardId) return reply.code(400).send({ error: "cardId fehlt" });
    if (req.body?.condition != null && !sanitizeCondition(req.body.condition)) {
      return reply
        .code(400)
        .send({ error: `Zustand muss einer von: ${CARD_CONDITIONS.join(", ")}` });
    }

    const item = await addToCollection(user.id, cardId, {
      quantity: sanitizeQuantity(req.body?.quantity, 1),
      condition: sanitizeCondition(req.body?.condition) ?? undefined,
      language: sanitizeText(req.body?.language, 10),
      notes: sanitizeText(req.body?.notes, 500),
    });
    if (!item) return reply.code(400).send({ error: `Unbekannte Karte: ${cardId}` });
    return reply.code(201).send(item);
  });

  app.get<{
    Querystring: { q?: string; set?: string; condition?: string; limit?: string; offset?: string };
  }>("/collection", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    const conds = [eq(collectionItems.userId, user.id)];
    let q = (req.query.q ?? "").trim();
    if (q.length > 100) q = ""; // Obergrenze gegen teure Suchabfragen
    if (q) {
      const like = `%${q}%`;
      conds.push(
        or(
          ilike(cards.nameDe, like),
          ilike(cards.nameEn, like),
          ilike(cards.number, like),
          ilike(cards.tcgdexId, like),
        )!,
      );
    }
    if (req.query.set) conds.push(eq(sets.tcgdexId, req.query.set));
    const condition = sanitizeCondition(req.query.condition);
    if (condition) conds.push(eq(collectionItems.condition, condition));

    const rows = await db
      .select(itemSelect)
      .from(collectionItems)
      .innerJoin(cards, eq(collectionItems.cardId, cards.id))
      .innerJoin(sets, eq(cards.setId, sets.id))
      .where(and(...conds))
      .orderBy(desc(collectionItems.updatedAt))
      .limit(limit)
      .offset(offset);

    // Gesamtzahl der Karten (nicht nur der Seite) fuer "x von y"
    const countRows = await db
      .select({
        n: sql<number>`count(*)::int`,
        cards: sql<number>`coalesce(sum(${collectionItems.quantity}), 0)::int`,
      })
      .from(collectionItems)
      .innerJoin(cards, eq(collectionItems.cardId, cards.id))
      .innerJoin(sets, eq(cards.setId, sets.id))
      .where(and(...conds));

    return {
      items: rows.map((r) => toItem(r as ItemRow)),
      total: countRows[0]?.n ?? 0,
      totalCards: countRows[0]?.cards ?? 0,
      limit,
      offset,
    };
  });

  app.get("/collection/stats", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const totals = await db
      .select({
        uniqueCards: sql<number>`count(*)::int`,
        totalCards: sql<number>`coalesce(sum(${collectionItems.quantity}), 0)::int`,
        lastAddedAt: sql<string | null>`max(${collectionItems.updatedAt})::text`,
      })
      .from(collectionItems)
      .where(eq(collectionItems.userId, user.id));

    const byCondition = await db
      .select({
        condition: collectionItems.condition,
        uniqueCards: sql<number>`count(*)::int`,
        totalCards: sql<number>`coalesce(sum(${collectionItems.quantity}), 0)::int`,
      })
      .from(collectionItems)
      .where(eq(collectionItems.userId, user.id))
      .groupBy(collectionItems.condition);

    const topSets = await db
      .select({
        setId: sets.tcgdexId,
        setName: sets.nameDe,
        uniqueCards: sql<number>`count(*)::int`,
        totalCards: sql<number>`coalesce(sum(${collectionItems.quantity}), 0)::int`,
      })
      .from(collectionItems)
      .innerJoin(cards, eq(collectionItems.cardId, cards.id))
      .innerJoin(sets, eq(cards.setId, sets.id))
      .where(eq(collectionItems.userId, user.id))
      .groupBy(sets.tcgdexId, sets.nameDe)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    const stats: CollectionStats = {
      totalCards: totals[0]?.totalCards ?? 0,
      uniqueCards: totals[0]?.uniqueCards ?? 0,
      byCondition: byCondition.map((r) => ({
        condition: r.condition,
        uniqueCards: r.uniqueCards,
        totalCards: r.totalCards,
      })),
      topSets: topSets.map((r) => ({
        setId: r.setId,
        setName: r.setName,
        uniqueCards: r.uniqueCards,
        totalCards: r.totalCards,
      })),
      lastAddedAt: totals[0]?.lastAddedAt ?? null,
    };
    return stats;
  });

  app.patch<{
    Params: { id: string };
    Body: { quantity?: unknown; condition?: unknown; language?: unknown; notes?: unknown };
  }>("/collection/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const rows = await db
      .select()
      .from(collectionItems)
      .where(and(eq(collectionItems.id, req.params.id), eq(collectionItems.userId, user.id)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "Eintrag nicht gefunden" });
    const current = rows[0];

    if (req.body?.condition != null && !sanitizeCondition(req.body.condition)) {
      return reply
        .code(400)
        .send({ error: `Zustand muss einer von: ${CARD_CONDITIONS.join(", ")}` });
    }
    const condition = sanitizeCondition(req.body?.condition) ?? current.condition;

    // Zustandswechsel auf einen bereits vorhandenen Eintrag -> zusammenfuehren
    if (condition !== current.condition) {
      const twin = await db
        .select()
        .from(collectionItems)
        .where(
          and(
            eq(collectionItems.userId, user.id),
            eq(collectionItems.cardId, current.cardId),
            eq(collectionItems.condition, condition),
          ),
        )
        .limit(1);
      if (twin.length > 0) {
        const merged = await db
          .update(collectionItems)
          .set({ quantity: twin[0].quantity + current.quantity, updatedAt: new Date() })
          .where(eq(collectionItems.id, twin[0].id))
          .returning({ id: collectionItems.id });
        await db.delete(collectionItems).where(eq(collectionItems.id, current.id));
        return (
          (await loadItem(merged[0].id)) ??
          reply.code(404).send({ error: "Eintrag nicht gefunden" })
        );
      }
    }

    const patch: Record<string, unknown> = { condition, updatedAt: new Date() };
    if (req.body?.quantity != null)
      patch.quantity = sanitizeQuantity(req.body.quantity, current.quantity);
    if ("language" in (req.body ?? {})) patch.language = sanitizeText(req.body?.language, 10);
    if ("notes" in (req.body ?? {})) patch.notes = sanitizeText(req.body?.notes, 500);

    const updated = await db
      .update(collectionItems)
      .set(patch)
      .where(eq(collectionItems.id, current.id))
      .returning({ id: collectionItems.id });
    return (
      (await loadItem(updated[0].id)) ?? reply.code(404).send({ error: "Eintrag nicht gefunden" })
    );
  });

  app.delete<{ Params: { id: string } }>("/collection/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const deleted = await db
      .delete(collectionItems)
      .where(and(eq(collectionItems.id, req.params.id), eq(collectionItems.userId, user.id)))
      .returning({ id: collectionItems.id });
    if (deleted.length === 0) return reply.code(404).send({ error: "Eintrag nicht gefunden" });
    return { deleted: true, id: deleted[0].id };
  });

  /** Kurzinfo "habe ich schon" fuer mehrere Karten (fuer die Trefferliste). */
  app.get<{ Querystring: { ids?: string } }>("/collection/has", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return { owned: [] };
    const ids = (req.query.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => CARD_ID_RE.test(s))
      .slice(0, 100);
    if (ids.length === 0) return { owned: [] };

    const rows = await db
      .select({
        tcgdexId: cards.tcgdexId,
        quantity: sql<number>`coalesce(sum(${collectionItems.quantity}), 0)::int`,
      })
      .from(collectionItems)
      .innerJoin(cards, eq(collectionItems.cardId, cards.id))
      .where(and(eq(collectionItems.userId, user.id), inArray(cards.tcgdexId, ids)))
      .groupBy(cards.tcgdexId);

    return { owned: rows.map((r) => ({ cardId: r.tcgdexId, quantity: r.quantity })) };
  });
}
