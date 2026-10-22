// Baut die Fastify-App (ohne listen) - so auch in Tests nutzbar.

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { collectionRoutes } from "./routes/collection.js";
import { cardRoutes } from "./routes/cards.js";
import { scanRoutes } from "./routes/scans.js";
import { recHealth } from "./lib/rec.js";

export type BuildOptions = {
  logger?: boolean;
  rateLimit?: boolean;
};

/**
 * Vertrauenswürdige Reverse-Proxies, aus denen `X-Forwarded-For` geglaubt wird.
 *
 * Ohne diese Angabe sieht die API nur die IP des Proxys. Das Rate-Limit zählt
 * dann alle Nutzer zusammen - ein einzelner Angreifer könnte mit 300 Anfragen
 * pro Minute die ganze Instanz aussperren. Umgekehrt darf die API nicht
 * direkt aus dem Internet erreichbar sein, sonst könnte ein Aufrufer den
 * Header fälschen und das Limit umgehen.
 *
 * Standard: private Adressbereiche (Docker-Netz) + Loopback + Link-Local.
 * `TRUST_PROXY=0` schaltet das Vertrauen ganz ab (nur sinnvoll, wenn die API
 * ohne Proxy läuft).
 */
function trustProxySetting(): string | false {
  const raw = (process.env.TRUST_PROXY ?? "uniquelocal,loopback,linklocal").trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "none") return false;
  return raw;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            transport:
              process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
          },
    bodyLimit: 16 * 1024 * 1024,
    trustProxy: trustProxySetting(),
  });

  const allowedOrigins = (
    process.env.CORS_ORIGINS ??
    // Dev-Server (Vite) und die gebaute Vorschau (vite preview, PWA-Tests)
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Anfragen ohne Origin (curl, native App, Tests) durchlassen
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Origin nicht erlaubt"), false);
    },
    credentials: true,
  });

  await app.register(sensible);
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 5 },
  });
  if (opts.rateLimit !== false) {
    await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  }

  await app.register(authPlugin);

  app.get("/health", async () => {
    // Keine Interna nach aussen: nur "funktioniert der Erkennungs-Service".
    const rec = await recHealth();
    return { status: "ok", ts: Date.now(), recognition: rec ? "ok" : "unavailable" };
  });

  await app.register(authRoutes);
  await app.register(collectionRoutes);
  await app.register(cardRoutes);
  await app.register(scanRoutes);

  // Fehlerbehandlung: nach aussen nur, was der Client wissen darf.
  // 4xx = verstaendliche Meldung (z. B. "unbekannte Karte"), 5xx = interner
  // Fehler -> generischer Text, Details stehen ausschliesslich im Log.
  // Sonst leaken z. B. Datenbank- oder Datei-Fehler Pfade und Schema-Namen.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, "Anfrage fehlgeschlagen");
      return reply.code(status).send({ error: "Interner Fehler" });
    }
    req.log.info({ status, msg: err.message }, "Anfrage abgelehnt");
    return reply.code(status).send({ error: err.message ?? "Ungueltige Anfrage" });
  });

  return app;
}
