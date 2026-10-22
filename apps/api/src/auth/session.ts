// Sitzungen: Zufallstoken im Cookie, in der DB nur der SHA-256-Hash.
//
// Kein Fremdpaket (siehe Entscheidung): Das Verfahren ist bewusst schlicht und
// nachvollziehbar - Token erzeugen, hashen, mit Ablauf speichern, bei Bedarf
// verlaengern (gleitende Sitzung), beim Logout loeschen.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, lt, and, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

const isProd = () => process.env.NODE_ENV === "production";

/**
 * Name des Sitzungs-Cookies.
 *
 * Im Betrieb mit "__Host-"-Praefix: der Browser akzeptiert ein so benanntes
 * Cookie nur, wenn es `Secure` gesetzt hat, auf "/" liegt und kein
 * Domain-Attribut traegt. Damit kann keine fremde Subdomain ein Sitzungs-Cookie
 * fuer diese Installation setzen.
 */
export const SESSION_COOKIE = isProd() ? "__Host-pcs_session" : "pcs_session";
/** Cookie-/Sitzungsdauer: 30 Tage. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Verlaengert die Sitzung, wenn weniger als 15 Tage uebrig sind. */
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

export type Session = {
  id: string;
  userId: string;
  expiresAt: Date;
};

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Prueft ein Token und liefert Nutzer + Sitzung (mit gleitender Verlaengerung). */
export async function validateSessionToken(
  token: string,
): Promise<{ user: SessionUser; session: Session } | null> {
  if (!token || token.length < 20) return null;
  const id = hashToken(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (rows.length === 0) return null;
  let { session } = rows[0];

  // Gleitende Verlaengerung
  if (session.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    session = { ...session, expiresAt };
  }

  return {
    user: toUser(rows[0].user),
    session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt },
  };
}

export async function invalidateSession(token: string): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Alle Sitzungen eines Nutzers beenden (z. B. nach Passwortwechsel). */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Abgelaufene Sitzungen aufraeumen (wird beim Start aufgerufen). */
export async function cleanupExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Zufalls-ID fuer anonyme Scans (eigenes Cookie, kein Konto). */
export function newAnonId(): string {
  return randomUUID();
}
