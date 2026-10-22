import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import type { QualityReport, RecognitionCandidate, SyncStats } from "@shared/types";

/**
 * Statistiken eines Sync-Laufs. Je nach Skript werden unterschiedliche Felder
 * gefüllt (TCGdex-Sync zählt Karten, der Namens-Sync zählt Treffer) - deshalb
 * sind alle Felder optional.
 */
export type SyncJobStats = Partial<SyncStats> & {
  todo?: number;
  updated?: number;
  missing?: number;
};

export const syncJobStatusEnum = pgEnum("sync_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const sets = pgTable(
  "sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tcgdexId: text("tcgdex_id").notNull().unique(),
    nameDe: text("name_de"),
    nameEn: text("name_en"),
    series: text("series"),
    releaseDate: text("release_date"),
    logoUrl: text("logo_url"),
    symbolPath: text("symbol_path"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tcgdexIdx: uniqueIndex("sets_tcgdex_id_idx").on(table.tcgdexId),
  }),
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tcgdexId: text("tcgdex_id").notNull().unique(),
    setId: uuid("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    nameDe: text("name_de"),
    nameEn: text("name_en"),
    hp: text("hp"),
    rarity: text("rarity"),
    types: jsonb("types").$type<string[]>().default([]),
    illustrator: text("illustrator"),
    regulationMark: text("regulation_mark"),
    variantsKnown: jsonb("variants_known").$type<string[]>().default([]),
    languageHint: text("language_hint").default("de"),
    imageUrl: text("image_url"),
    localImagePath: text("local_image_path"),
    hasHolo: boolean("has_holo").default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tcgdexIdx: uniqueIndex("cards_tcgdex_id_idx").on(table.tcgdexId),
    setNumberIdx: index("cards_set_number_idx").on(table.setId, table.number),
  }),
);

export const cardEmbeddings = pgTable(
  "card_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dim: integer("dim").notNull(),
    vector: jsonb("vector").$type<number[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    cardModelIdx: uniqueIndex("card_embeddings_card_model_idx").on(table.cardId, table.model),
  }),
);

export const syncJobs = pgTable("sync_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  status: syncJobStatusEnum("status").notNull().default("pending"),
  statsJson: jsonb("stats_json").$type<SyncJobStats>(),
  errorText: text("error_text"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Nutzer, Sitzungen, Sammlung -------------------------------------------
// Anmeldung ohne Fremdbibliothek: Passwoerter mit Argon2id, Sitzungen als
// Zufallstoken (in der DB nur der SHA-256-Hash), Cookie httpOnly + SameSite=Lax.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // immer kleingeschrieben gespeichert (Login ist case-insensitive)
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256-Hash des Cookies (Klartext-Token steht nur im Cookie der Nutzerin)
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
    expiresIdx: index("sessions_expires_idx").on(table.expiresAt),
  }),
);

export const cardConditionEnum = pgEnum("card_condition", [
  "mint",
  "near_mint",
  "excellent",
  "good",
  "played",
  "poor",
]);

export const collectionItems = pgTable(
  "collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    condition: cardConditionEnum("condition").notNull().default("near_mint"),
    // Sprache der physischen Karte (kann von der Katalogsprache abweichen)
    language: text("language"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex("collection_user_card_condition_idx").on(
      table.userId,
      table.cardId,
      table.condition,
    ),
    userIdx: index("collection_user_idx").on(table.userId),
  }),
);

// --- Scan-Feedback-Loop -----------------------------------------------------
// Jeder Scan wird gespeichert (Bild + Top-Kandidaten + Ergebnis). Die Nutzer-
// Bestaetigung/-Korrektur ist das Trainingssignal fuer die Schwellenkalibrierung.
export const scanStatusEnum = pgEnum("scan_status", [
  "pending", // Kandidaten gezeigt, Nutzer hat noch nichts bestaetigt
  "auto", // automatisch uebernommen (Konsens war eindeutig)
  "confirmed", // Nutzer hat den Auto-/Top-1-Vorschlag bestaetigt
  "corrected", // Nutzer hat eine andere Karte gewaehlt (=> Fehler erkannt)
  "rejected", // Nutzer hat verworfen (Karte nicht gefunden)
]);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: scanStatusEnum("status").notNull().default("pending"),
    // Nutzer (NULL = anonymer Scan, siehe anonId)
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Zufalls-ID aus einem Cookie: anonyme Scans bleiben so beim selben Browser
    anonId: text("anon_id"),
    // Pfad zum normalisierten Foto (EXIF/GPS entfernt) relativ zu UPLOADS_DIR
    imagePath: text("image_path"),
    // Kandidatenliste des rec-Service (JSON, inkl. Scores je Methode)
    candidates: jsonb("candidates").$type<RecognitionCandidate[]>().default([]),
    autoCardId: uuid("auto_card_id").references(() => cards.id, { onDelete: "set null" }),
    chosenCardId: uuid("chosen_card_id").references(() => cards.id, { onDelete: "set null" }),
    reason: text("reason"),
    autoSave: boolean("auto_save").default(false).notNull(),
    quality: jsonb("quality").$type<QualityReport>(),
    ocrName: text("ocr_name"),
    ocrNumber: text("ocr_number"),
    elapsedMs: integer("elapsed_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("scans_created_at_idx").on(table.createdAt),
    chosenIdx: index("scans_chosen_card_idx").on(table.chosenCardId),
    statusIdx: index("scans_status_idx").on(table.status),
    userIdx: index("scans_user_idx").on(table.userId),
    anonIdx: index("scans_anon_idx").on(table.anonId),
  }),
);
