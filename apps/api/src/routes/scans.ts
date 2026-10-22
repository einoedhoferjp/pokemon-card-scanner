// Scan-Endpunkte: Erkennung anstossen, Ergebnis speichern, Feedback annehmen.
//
// Ablauf:
//   POST /scans            Foto -> rec-Service -> Scan-Zeile (Status pending/auto)
//   GET  /scans/:id        Scan inkl. Kandidaten
//   PATCH /scans/:id       Feedback: confirm | correct | reject  (Kalibrier-Signal)
//   GET  /scans            letzte Scans (Sammlung/Verlauf, spaeter pro Nutzer)
//   GET  /scans/:id/image  hochgeladenes Foto
//   DELETE /scans/:id      Scan + Foto loeschen (DSGVO)
//
// Nach aussen werden ausschliesslich TCGdex-IDs verwendet (keine DB-UUIDs) -
// das haelt die API stabil und die Web-App kennt nur Karten-IDs.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { CardSummary, Scan, ScanFeedback } from "@shared/types";
import { db } from "../db/client.js";
import { cards, scans, sets } from "../db/schema.js";
import {
  deleteScanImage,
  normalizeUpload,
  saveScanImage,
  scanImagePath,
  sniffImageType,
} from "../lib/images.js";
import { addToCollection, removeOneFromCollection } from "../lib/collection.js";
import { ensureAnonId } from "../auth/plugin.js";
import { recognizeImage, RecError } from "../lib/rec.js";
import { errorMessage } from "../lib/errors.js";

const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

type ScanRow = typeof scans.$inferSelect;

/**
 * Sichtbarkeit: angemeldete Nutzer sehen ihre eigenen Scans, anonyme Nutzer die
 * Scans ihres Browsers (Cookie `pcs_anon`). Ohne beides gibt es keine Treffer.
 */
function ownerFilter(req: FastifyRequest) {
  if (req.user) return eq(scans.userId, req.user.id);
  const anon = req.anonId;
  if (!anon) return sql`false`;
  return and(isNull(scans.userId), eq(scans.anonId, anon))!;
}

/** DB-UUIDs (auto/chosen) -> TCGdex-IDs, damit die API nur Karten-IDs zeigt. */
async function tcgdexMap(rows: ScanRow[]): Promise<Map<string, string>> {
  const uuids = [
    ...new Set(
      rows.flatMap((r) => [r.chosenCardId, r.autoCardId]).filter((v): v is string => Boolean(v)),
    ),
  ];
  if (uuids.length === 0) return new Map();
  const found = await db
    .select({ id: cards.id, tcgdexId: cards.tcgdexId })
    .from(cards)
    .where(inArray(cards.id, uuids));
  return new Map(found.map((r) => [r.id, r.tcgdexId]));
}

function toScan(row: ScanRow, ids: Map<string, string>): Scan {
  return {
    id: row.id,
    status: row.status,
    imageUrl: row.imagePath ? `/scans/${row.id}/image` : null,
    candidates: (row.candidates ?? []) as Scan["candidates"],
    chosenCardId: row.chosenCardId ? (ids.get(row.chosenCardId) ?? null) : null,
    autoCardId: row.autoCardId ? (ids.get(row.autoCardId) ?? null) : null,
    recognition: {
      autoSave: row.autoSave,
      reason: row.reason ?? "",
      ocrName: row.ocrName,
      ocrNumber: row.ocrNumber,
      elapsedMs: row.elapsedMs ?? 0,
      quality: (row.quality ?? {}) as Scan["recognition"]["quality"],
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** tcgdex_id -> cards.id (fuer Auto- und Nutzerauswahl). */
async function cardIdsByTcgdex(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = ids.filter((v): v is string => Boolean(v) && CARD_ID_RE.test(v!));
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: cards.id, tcgdexId: cards.tcgdexId })
    .from(cards)
    .where(inArray(cards.tcgdexId, wanted));
  return new Map(rows.map((r) => [r.tcgdexId, r.id]));
}

async function summariesFor(ids: string[]): Promise<CardSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      tcgdexId: cards.tcgdexId,
      nameDe: cards.nameDe,
      nameEn: cards.nameEn,
      number: cards.number,
      rarity: cards.rarity,
      localImagePath: cards.localImagePath,
      setId: sets.tcgdexId,
      setName: sets.nameDe,
    })
    .from(cards)
    .innerJoin(sets, eq(cards.setId, sets.id))
    .where(inArray(cards.tcgdexId, ids));
  const byId = new Map(rows.map((r) => [r.tcgdexId, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => Boolean(r))
    .map((r) => ({
      tcgdexId: r.tcgdexId,
      nameDe: r.nameDe,
      nameEn: r.nameEn,
      number: r.number,
      setId: r.setId,
      setName: r.setName,
      rarity: r.rarity,
      hasImage: Boolean(r.localImagePath),
      imageUrl: r.localImagePath ? `/cards/${encodeURIComponent(r.tcgdexId)}/image` : null,
    }));
}

export async function scanRoutes(app: FastifyInstance) {
  app.post(
    "/scans",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "Feld 'image' fehlt" });

      const raw = await file.toBuffer();
      let normalized;
      try {
        normalized = await normalizeUpload(raw);
      } catch (e) {
        // Die Meldungen stammen aus eigenem Code (kurz und harmlos); technische
        // Details landen nur im Log.
        req.log.info({ err: e }, "Upload abgelehnt");
        return reply.code(400).send({ error: errorMessage(e) });
      }

      let result;
      try {
        result = await recognizeImage(normalized.buffer);
      } catch (e) {
        const status = e instanceof RecError && e.status ? 502 : 503;
        // Die Antwort des Erkennungs-Dienstes kann Interna enthalten - deshalb
        // nur protokollieren, nicht weitergeben.
        req.log.error({ err: e }, "Erkennung fehlgeschlagen");
        return reply
          .code(status)
          .send({ error: "Erkennung fehlgeschlagen - bitte erneut versuchen" });
      }

      const top = result.candidates[0] ?? null;
      const idMap = await cardIdsByTcgdex([top?.cardId ?? null]);
      const autoCardId = top ? (idMap.get(top.cardId) ?? null) : null;

      const scanId = randomUUID();
      let imagePath: string | null = null;
      try {
        imagePath = await saveScanImage(scanId, normalized.buffer);
      } catch (e) {
        req.log.warn({ err: e }, "Scan-Foto konnte nicht gespeichert werden");
      }

      const inserted = await db
        .insert(scans)
        .values({
          id: scanId,
          status: result.autoSave ? "auto" : "pending",
          userId: req.user?.id ?? null,
          anonId: req.user ? null : ensureAnonId(req, reply),
          imagePath,
          candidates: result.candidates,
          autoCardId,
          chosenCardId: result.autoSave ? autoCardId : null,
          reason: result.reason,
          autoSave: result.autoSave,
          quality: result.quality,
          ocrName: result.ocrName,
          ocrNumber: result.ocrNumber,
          elapsedMs: result.elapsedMs,
        })
        .returning();

      // Automatische Uebernahme (Konsens) landet direkt in der Sammlung.
      if (result.autoSave && req.user && top) {
        try {
          await addToCollection(req.user.id, top.cardId);
        } catch (e) {
          req.log.warn({ err: e }, "Auto-Scan konnte nicht in die Sammlung uebernommen werden");
        }
      }

      // Fuer die Antwort genuegt die Zuordnung der Auto-Karte
      const ids = new Map<string, string>();
      if (autoCardId && top) ids.set(autoCardId, top.cardId);
      return reply.code(201).send(toScan(inserted[0], ids));
    },
  );

  app.get<{ Querystring: { limit?: string; status?: string } }>("/scans", async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 100);
    const conds = [ownerFilter(req)];
    if (req.query.status) conds.push(eq(scans.status, req.query.status as ScanRow["status"]));
    const rows = await db
      .select()
      .from(scans)
      .where(and(...conds))
      .orderBy(desc(scans.createdAt))
      .limit(limit);
    const ids = await tcgdexMap(rows);
    return { scans: rows.map((r) => toScan(r, ids)) };
  });

  app.get<{ Params: { id: string } }>("/scans/:id", async (req, reply) => {
    const rows = await db
      .select()
      .from(scans)
      .where(and(eq(scans.id, req.params.id), ownerFilter(req)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "Scan nicht gefunden" });
    const ids = await tcgdexMap(rows);
    const scan = toScan(rows[0], ids);
    const wished = [scan.chosenCardId, scan.autoCardId, ...scan.candidates.map((c) => c.cardId)];
    const unique = [...new Set(wished.filter((v): v is string => Boolean(v)))];
    return { scan, cards: await summariesFor(unique) };
  });

  // Feedback = Kalibrier-Signal: bestaetigt, korrigiert (Fehler!) oder verworfen.
  app.patch<{ Params: { id: string }; Body: ScanFeedback }>("/scans/:id", async (req, reply) => {
    const body = req.body ?? ({} as ScanFeedback);
    if (!["confirm", "correct", "reject"].includes(body?.action)) {
      return reply.code(400).send({ error: "action muss confirm, correct oder reject sein" });
    }
    const rows = await db
      .select()
      .from(scans)
      .where(and(eq(scans.id, req.params.id), ownerFilter(req)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "Scan nicht gefunden" });
    const current = rows[0];
    // Welche Karte liegt wegen dieses Scans bereits in der Sammlung?
    // "auto" uebernimmt beim Anlegen, bestaetigt/korrigiert beim Feedback.
    const previous =
      current.chosenCardId && current.status !== "pending" && current.status !== "rejected"
        ? ((await tcgdexMap([current])).get(current.chosenCardId) ?? null)
        : null;

    if (body.action === "reject") {
      const updated = await db
        .update(scans)
        .set({ status: "rejected", chosenCardId: null, updatedAt: new Date() })
        .where(eq(scans.id, current.id))
        .returning();
      // War die Karte schon (automatisch) in der Sammlung, wieder herausnehmen.
      if (req.user && previous) {
        try {
          await removeOneFromCollection(req.user.id, previous);
        } catch (e) {
          req.log.warn({ err: e }, "Karte konnte nicht aus der Sammlung entfernt werden");
        }
      }
      const ids = await tcgdexMap(updated);
      return toScan(updated[0], ids);
    }

    const cardId = body.cardId ?? current.candidates?.[0]?.cardId;
    if (!cardId) return reply.code(400).send({ error: "cardId fehlt" });
    const idMap = await cardIdsByTcgdex([cardId]);
    const uuid = idMap.get(cardId);
    if (!uuid) return reply.code(400).send({ error: `Unbekannte Karte: ${cardId}` });

    // "correct" nur, wenn eine automatische Zuordnung durch den Nutzer ersetzt wird
    const status =
      body.action === "correct" && current.autoCardId && current.autoCardId !== uuid
        ? "corrected"
        : "confirmed";
    const updated = await db
      .update(scans)
      .set({ status, chosenCardId: uuid, updatedAt: new Date() })
      .where(eq(scans.id, current.id))
      .returning();

    // Sammlung nachfuehren: eine falsch hinterlegte Karte zuruecknehmen und die
    // gewaehlte hinzufuegen. Erneutes Bestaetigen derselben Karte zaehlt nur einmal.
    if (req.user && previous !== cardId) {
      try {
        if (previous) await removeOneFromCollection(req.user.id, previous);
        await addToCollection(req.user.id, cardId);
      } catch (e) {
        req.log.warn({ err: e }, "Scan konnte nicht in die Sammlung uebernommen werden");
      }
    }

    const ids = await tcgdexMap(updated);
    return toScan(updated[0], ids);
  });

  app.get<{ Params: { id: string } }>("/scans/:id/image", async (req, reply) => {
    const rows = await db
      .select({ imagePath: scans.imagePath })
      .from(scans)
      .where(and(eq(scans.id, req.params.id), ownerFilter(req)))
      .limit(1);
    if (rows.length === 0 || !rows[0].imagePath)
      return reply.code(404).send({ error: "Kein Foto" });
    const full = scanImagePath(rows[0].imagePath!);
    if (!full) return reply.code(404).send({ error: "Kein Foto" });
    let buf: Buffer;
    try {
      buf = await readFile(full);
    } catch {
      return reply.code(404).send({ error: "Kein Foto" });
    }
    if (!sniffImageType(buf)) return reply.code(404).send({ error: "Kein Foto" });
    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "private, max-age=3600")
      .send(buf);
  });

  // DSGVO: Scan inkl. Foto loeschen.
  app.delete<{ Params: { id: string } }>("/scans/:id", async (req, reply) => {
    const rows = await db
      .select()
      .from(scans)
      .where(and(eq(scans.id, req.params.id), ownerFilter(req)))
      .limit(1);
    if (rows.length === 0) return reply.code(404).send({ error: "Scan nicht gefunden" });
    await deleteScanImage(rows[0].imagePath);
    await db.delete(scans).where(eq(scans.id, req.params.id));
    return { deleted: true, id: req.params.id };
  });
}
