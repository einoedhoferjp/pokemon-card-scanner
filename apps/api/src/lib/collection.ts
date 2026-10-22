// Gemeinsame Bausteine der Sammlung (Drizzle-Zugriffe, Validierung, Mapping).
// Wird von den Sammlungs-Routen UND vom Bestaetigen eines Scans genutzt.

import { and, desc, eq, sql } from "drizzle-orm";
import type { CardCondition, CollectionItem } from "@shared/types";
import { db } from "../db/client.js";
import { cardConditionEnum, cards, collectionItems, sets } from "../db/schema.js";

const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Erlaubte Zustaende - bewusst aus dem DB-Enum abgeleitet (statt aus
 * `@shared/types`): die API laeuft im Betrieb unter reinem Node, das die
 * TypeScript-Quellen des Shared-Pakets nicht laden kann.
 */
export const CARD_CONDITIONS = cardConditionEnum.enumValues;

export const itemSelect = {
  id: collectionItems.id,
  quantity: collectionItems.quantity,
  condition: collectionItems.condition,
  language: collectionItems.language,
  notes: collectionItems.notes,
  createdAt: collectionItems.createdAt,
  updatedAt: collectionItems.updatedAt,
  tcgdexId: cards.tcgdexId,
  nameDe: cards.nameDe,
  nameEn: cards.nameEn,
  number: cards.number,
  rarity: cards.rarity,
  localImagePath: cards.localImagePath,
  setId: sets.tcgdexId,
  setName: sets.nameDe,
};

export type ItemRow = {
  id: string;
  quantity: number;
  condition: CardCondition;
  language: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  tcgdexId: string;
  nameDe: string | null;
  nameEn: string | null;
  number: string;
  rarity: string | null;
  localImagePath: string | null;
  setId: string;
  setName: string | null;
};

export function toItem(row: ItemRow): CollectionItem {
  return {
    id: row.id,
    quantity: row.quantity,
    condition: row.condition,
    language: row.language,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    card: {
      tcgdexId: row.tcgdexId,
      nameDe: row.nameDe,
      nameEn: row.nameEn,
      number: row.number,
      setId: row.setId,
      setName: row.setName,
      rarity: row.rarity,
      imageUrl: row.localImagePath ? `/cards/${encodeURIComponent(row.tcgdexId)}/image` : null,
    },
  };
}

export async function cardDbId(tcgdexId: string): Promise<string | null> {
  if (!CARD_ID_RE.test(tcgdexId)) return null;
  const rows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.tcgdexId, tcgdexId))
    .limit(1);
  return rows[0]?.id ?? null;
}

export function sanitizeQuantity(value: unknown, fallback = 1): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), 999);
}

export function sanitizeCondition(value: unknown): CardCondition | null {
  return typeof value === "string" && (CARD_CONDITIONS as string[]).includes(value)
    ? (value as CardCondition)
    : null;
}

export function sanitizeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Menge um 1 verringern (Eintrag verschwindet bei 0).
 * Bevorzugt den Eintrag im Standardzustand "near_mint" - so wird genau die
 * Karte zurueckgenommen, die zuvor automatisch/bestaetigend hinzugefuegt wurde.
 */
export async function removeOneFromCollection(userId: string, tcgdexId: string): Promise<void> {
  const cardId = await cardDbId(tcgdexId);
  if (!cardId) return;
  const rows = await db
    .select({ id: collectionItems.id, quantity: collectionItems.quantity })
    .from(collectionItems)
    .where(and(eq(collectionItems.userId, userId), eq(collectionItems.cardId, cardId)))
    .orderBy(
      sql`(${collectionItems.condition} = 'near_mint') desc`,
      desc(collectionItems.updatedAt),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.quantity > 1) {
    await db
      .update(collectionItems)
      .set({ quantity: row.quantity - 1, updatedAt: new Date() })
      .where(eq(collectionItems.id, row.id));
  } else {
    await db.delete(collectionItems).where(eq(collectionItems.id, row.id));
  }
}

/** Einen Eintrag (mit Kartendaten) anhand seiner ID laden. */
export async function loadItem(id: string): Promise<CollectionItem | null> {
  const rows = await db
    .select(itemSelect)
    .from(collectionItems)
    .innerJoin(cards, eq(collectionItems.cardId, cards.id))
    .innerJoin(sets, eq(cards.setId, sets.id))
    .where(eq(collectionItems.id, id))
    .limit(1);
  return rows[0] ? toItem(rows[0] as ItemRow) : null;
}

/**
 * Karte zur Sammlung hinzufuegen bzw. Menge erhoehen.
 * Genutzt von POST /collection und beim Bestaetigen eines Scans.
 */
export async function addToCollection(
  userId: string,
  tcgdexId: string,
  opts: {
    quantity?: number;
    condition?: CardCondition;
    language?: string | null;
    notes?: string | null;
  } = {},
): Promise<CollectionItem | null> {
  const cardId = await cardDbId(tcgdexId);
  if (!cardId) return null;

  const quantity = sanitizeQuantity(opts.quantity, 1);
  const condition = opts.condition ?? "near_mint";

  const inserted = await db
    .insert(collectionItems)
    .values({
      userId,
      cardId,
      quantity,
      condition,
      language: opts.language ?? null,
      notes: opts.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [collectionItems.userId, collectionItems.cardId, collectionItems.condition],
      set: {
        quantity: sql`${collectionItems.quantity} + ${quantity}`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: collectionItems.id });

  return loadItem(inserted[0].id);
}
