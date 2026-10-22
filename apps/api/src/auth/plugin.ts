// Anmeldung als Fastify-Plugin: Cookie einlesen, Sitzung aufloesen, Nutzer an
// den Request haengen. `requireUser` schuetzt einzelne Routen.
//
// Cookies:
//   pcs_session  Sitzungstoken (httpOnly, SameSite=Lax, 30 Tage)
//   pcs_anon     Zufalls-ID fuer anonyme Scans (httpOnly, 1 Jahr)

import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type SessionUser,
  newAnonId,
  validateSessionToken,
} from "./session.js";

const isProd = () => process.env.NODE_ENV === "production";

/** Anonym-Cookie - im Betrieb mit "__Host-"-Praefix (siehe session.ts). */
export const ANON_COOKIE = isProd() ? "__Host-pcs_anon" : "pcs_anon";
const ANON_TTL_MS = 365 * 24 * 60 * 60 * 1000;

declare module "fastify" {
  interface FastifyRequest {
    /** angemeldeter Nutzer oder null */
    user: SessionUser | null;
    /** ID aus dem Anonym-Cookie (nur wenn vorhanden) */
    anonId: string | null;
  }
}

export const authPlugin: FastifyPluginAsync = fp(
  async (app) => {
    await app.register(cookie, {
      secret: process.env.COOKIE_SECRET || process.env.AUTH_SECRET || undefined,
      hook: "onRequest",
    });

    app.decorateRequest("user", null);
    app.decorateRequest("anonId", null);

    app.addHook("onRequest", async (req) => {
      req.anonId = req.cookies[ANON_COOKIE] ?? null;
      const token = req.cookies[SESSION_COOKIE];
      if (!token) {
        req.user = null;
        return;
      }
      const valid = await validateSessionToken(token);
      req.user = valid?.user ?? null;
    });

    // CSRF-Schutz: schreibende Anfragen duerfen nur von erlaubten Origins kommen.
    const allowed = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    app.addHook("onRequest", async (req, reply) => {
      if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
      const origin = req.headers.origin;
      // Ohne Origin (curl, Tests, native App) durchlassen - ein Browser sendet ihn immer.
      if (!origin) return;
      if (allowed.includes(origin)) return;
      reply.code(403).send({ error: "Origin nicht erlaubt" });
    });

    // Antworten mit Kontodaten nie im Browser- oder Proxy-Cache ablegen.
    app.addHook("onSend", async (req, reply, payload) => {
      if (req.url.startsWith("/auth")) reply.header("cache-control", "no-store");
      return payload;
    });
  },
  { name: "auth" },
);

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Liefert die Anonym-ID und setzt das Cookie, falls es noch fehlt. */
export function ensureAnonId(req: FastifyRequest, reply: FastifyReply): string {
  if (req.anonId) return req.anonId;
  const id = newAnonId();
  req.anonId = id;
  reply.setCookie(ANON_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    maxAge: Math.floor(ANON_TTL_MS / 1000),
  });
  return id;
}

/** Gibt den Nutzer zurueck oder beantwortet die Anfrage mit 401. */
export function requireUser(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  if (!req.user) {
    reply.code(401).send({ error: "Nicht angemeldet" });
    return null;
  }
  return req.user;
}
