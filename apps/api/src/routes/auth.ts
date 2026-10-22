// Anmeldung: Registrierung, Login, Logout, eigenes Profil.
//
// Bewusst schlank gehalten (kein Fremdpaket):
//   Passwort -> Argon2id, Sitzungstoken -> Zufall, DB speichert nur den Hash.
// Beim Anmelden werden anonyme Scans dieses Browsers uebernommen, damit der
// Verlauf nach dem Login nicht leer ist.

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@shared/types";
import { db } from "../db/client.js";
import { scans, users } from "../db/schema.js";
import { fakeVerify, hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, ensureAnonId, requireUser, setSessionCookie } from "../auth/plugin.js";
import {
  createSession,
  invalidateSession,
  invalidateUserSessions,
  SESSION_COOKIE,
} from "../auth/session.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

type Credentials = { email?: unknown; password?: unknown; displayName?: unknown };

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** Anonyme Scans dieses Browsers dem Konto zuschlagen. */
async function claimAnonymousScans(anonId: string | null, userId: string): Promise<number> {
  if (!anonId) return 0;
  const claimed = await db
    .update(scans)
    .set({ userId, anonId: null })
    .where(eq(scans.anonId, anonId))
    .returning({ id: scans.id });
  return claimed.length;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: Credentials }>(
    "/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const email = normalizeEmail(req.body?.email);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const displayName =
        typeof req.body?.displayName === "string" && req.body.displayName.trim()
          ? req.body.displayName.trim().slice(0, 60)
          : null;

      if (!email)
        return reply.code(400).send({ error: "Bitte eine gueltige E-Mail-Adresse angeben" });
      if (password.length < MIN_PASSWORD)
        return reply
          .code(400)
          .send({ error: `Passwort braucht mindestens ${MIN_PASSWORD} Zeichen` });
      if (password.length > MAX_PASSWORD)
        return reply.code(400).send({ error: "Passwort ist zu lang" });

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing.length > 0) {
        // Bewusst gleiche Antwort wie bei Erfolg? Nein: Registrierung darf die
        // Existenz verraten (sonst unbrauchbare UX) - der Login tut es nicht.
        return reply.code(409).send({ error: "Diese E-Mail-Adresse ist bereits registriert" });
      }

      const passwordHash = await hashPassword(password);
      const inserted = await db
        .insert(users)
        .values({ email, passwordHash, displayName })
        .returning();

      const anonId = ensureAnonId(req, reply);
      const claimed = await claimAnonymousScans(anonId, inserted[0].id);

      const { token, expiresAt } = await createSession(inserted[0].id);
      setSessionCookie(reply, token, expiresAt);
      return reply.code(201).send({ user: toAuthUser(inserted[0]), claimedScans: claimed });
    },
  );

  app.post<{ Body: Credentials }>(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const email = normalizeEmail(req.body?.email);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!email || !password) return reply.code(400).send({ error: "E-Mail und Passwort fehlen" });

      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (rows.length === 0) {
        await fakeVerify(password); // Zeitverhalten angleichen
        return reply.code(401).send({ error: "E-Mail oder Passwort ist falsch" });
      }
      const ok = await verifyPassword(rows[0].passwordHash, password);
      if (!ok) return reply.code(401).send({ error: "E-Mail oder Passwort ist falsch" });

      const anonId = ensureAnonId(req, reply);
      const claimed = await claimAnonymousScans(anonId, rows[0].id);

      const { token, expiresAt } = await createSession(rows[0].id);
      setSessionCookie(reply, token, expiresAt);
      return { user: toAuthUser(rows[0]), claimedScans: claimed };
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await invalidateSession(token);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req) => {
    return { user: req.user };
  });

  app.patch<{ Body: { displayName?: unknown; password?: unknown; currentPassword?: unknown } }>(
    "/auth/me",
    async (req, reply) => {
      const user = requireUser(req, reply);
      if (!user) return;

      const patch: { displayName?: string | null; passwordHash?: string; updatedAt: Date } = {
        updatedAt: new Date(),
      };

      if ("displayName" in (req.body ?? {})) {
        const name = req.body?.displayName;
        patch.displayName =
          typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;
      }

      let passwordChanged = false;
      if (typeof req.body?.password === "string" && req.body.password.length > 0) {
        if (req.body.password.length < MIN_PASSWORD)
          return reply
            .code(400)
            .send({ error: `Passwort braucht mindestens ${MIN_PASSWORD} Zeichen` });
        const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
        const current =
          typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
        if (!rows[0] || !(await verifyPassword(rows[0].passwordHash, current))) {
          return reply.code(400).send({ error: "Aktuelles Passwort ist falsch" });
        }
        patch.passwordHash = await hashPassword(req.body.password);
        passwordChanged = true;
      }

      const updated = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();

      if (passwordChanged) {
        // Alle Sitzungen beenden und die aktuelle neu ausstellen
        await invalidateUserSessions(user.id);
        const { token, expiresAt } = await createSession(user.id);
        setSessionCookie(reply, token, expiresAt);
      }

      return { user: toAuthUser(updated[0]) };
    },
  );
}
