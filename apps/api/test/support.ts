// Gemeinsame Helfer der API-Tests: Cookie-Verwaltung, Multipart-Bodies,
// rec-Service-Attrappe und Testdaten-Aufraeumen.

import assert from "node:assert/strict";
import sharp from "sharp";
import { inArray, like } from "drizzle-orm";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { db } from "../src/db/client.js";
import { scans, users } from "../src/db/schema.js";

export const CANNED = {
  candidates: [
    {
      cardId: "base1-4",
      nameDe: "Glurak",
      nameEn: "Charizard",
      number: "4",
      setId: "base1",
      setName: "Grundset",
      final: 0.96,
      phashDist: 2,
      embSim: 0.97,
      ocrNumber: 1,
      ocrName: 1,
      hasImage: true,
    },
    {
      cardId: "base1-58",
      nameDe: "Pikachu",
      nameEn: "Pikachu",
      number: "58",
      setId: "base1",
      setName: "Grundset",
      final: 0.42,
      phashDist: 14,
      embSim: 0.72,
      ocrNumber: 0,
      ocrName: 0.2,
      hasImage: true,
    },
  ],
  autoSave: true,
  reason: "Konsens: OCR bestaetigt (final=0.96, margin=0.54)",
  ocrName: "Charizard",
  ocrNumber: "4",
  quality: { ok: true, cardDetected: true, metrics: { sharpness: 300 } },
  elapsedMs: 1234,
};

export async function jpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 420, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer();
}

/** Minimaler multipart-Body-Builder (kein FormData-Overhead in Tests). */
export function multipartBody(file: Buffer, filename = "scan.jpg"): Buffer {
  const boundary = "X";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, file, tail]);
}

/** rec-Service durch eine feste Antwort ersetzen (keine Modell-Ladung im Test). */
export function stubRec(impl?: () => { status: number; body: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const r = impl ? impl() : { status: 200, body: CANNED };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/**
 * Kleines Cookie-Glas: Fastify-Inject speichert Cookies nicht selbst, deshalb
 * lesen wir `set-cookie` aus den Antworten und schicken sie bei Bedarf mit.
 */
export class Session {
  private jar = new Map<string, string>();

  get cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Cookie-Wert lesen (z. B. `pcs_anon`). */
  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  absorb(res: LightMyRequestResponse): void {
    const raw = res.headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const line of list) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  /** Anfrage mit den aktuellen Cookies ausfuehren und neue Cookies einsammeln. */
  async inject(app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> {
    const res = await app.inject({
      ...opts,
      headers: {
        ...(opts.headers ?? {}),
        ...(this.cookieHeader ? { cookie: this.cookieHeader } : {}),
      },
    });
    this.absorb(res);
    return res;
  }
}

export type TestUser = { email: string; password: string; id: string };

let userCounter = 0;

/** Legt ein Testkonto an; die Session hat danach das Sitzungscookie. */
export async function registerUser(
  app: FastifyInstance,
  session: Session,
  overrides: { email?: string; password?: string } = {},
): Promise<TestUser> {
  userCounter += 1;
  const email =
    overrides.email ??
    `test-${Date.now()}-${userCounter}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password ?? "geheim1234";
  const res = await session.inject(app, {
    method: "POST",
    url: "/auth/register",
    payload: { email, password, displayName: "Testnutzer" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { email, password, id: res.json().user.id };
}

/** Foto hochladen (rec ist gestubbt) und den erzeugten Scan zurueckgeben. */
export async function uploadScan(
  app: FastifyInstance,
  session: Session,
  body: unknown = CANNED,
): Promise<LightMyRequestResponse> {
  const restore = stubRec(() => ({ status: 200, body }));
  try {
    return await session.inject(app, {
      method: "POST",
      url: "/scans",
      headers: { "content-type": "multipart/form-data; boundary=X" },
      payload: multipartBody(await jpeg()),
    });
  } finally {
    restore();
  }
}

/** Alle Daten der Testkonten entfernen (Scans, Sammlung, Sitzungen, Nutzer). */
export async function cleanupTestData(): Promise<void> {
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "test-%@example.com"));
  const ids = testUsers.map((r) => r.id);
  if (ids.length === 0) return;
  await db.delete(scans).where(inArray(scans.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}
