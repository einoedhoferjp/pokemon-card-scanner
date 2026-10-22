// Integrationstests der Scan-/Karten-Routen.
//
// Der rec-Service wird per fetch-Stub ersetzt (keine Modell-Ladung), die DB ist
// die lokale Entwicklungs-DB. Ohne erreichbare DB werden diese Tests uebersprungen.

import "../src/env.js";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { count } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { closeDb, db } from "../src/db/client.js";
import { cards } from "../src/db/schema.js";
import { CANNED, Session, jpeg, multipartBody, stubRec, uploadScan } from "./support.js";

// DB-Verbindung am Dateiende schliessen, sonst endet der Testprozess nicht.
after(async () => {
  await closeDb();
});

let dbReady = false;
try {
  const rows = await db.select({ n: count() }).from(cards);
  dbReady = Number(rows[0]?.n ?? 0) > 0;
} catch {
  dbReady = false;
}
const skip = dbReady ? false : "lokale DB nicht erreichbar/leer";

test("POST /scans erkennt, speichert und liefert Kandidaten", { skip }, async () => {
  const restore = stubRec();
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const res = await session.inject(app, {
      method: "POST",
      url: "/scans",
      headers: { "content-type": "multipart/form-data; boundary=X" },
      payload: multipartBody(await jpeg()),
    });
    assert.equal(res.statusCode, 201, res.body);
    const scan = res.json();
    assert.equal(scan.status, "auto");
    assert.equal(scan.recognition.autoSave, true);
    assert.equal(scan.candidates[0].cardId, "base1-4");
    assert.equal(scan.candidates.length, 2);
    assert.ok(scan.imageUrl.startsWith("/scans/"));
    // Nach aussen nur TCGdex-IDs, keine DB-UUIDs
    assert.equal(scan.chosenCardId, "base1-4");
    assert.equal(scan.autoCardId, "base1-4");
    assert.match(scan.recognition.reason, /Konsens/);
    // Anonyme Scans haengen an einem Browser-Cookie
    assert.ok(session.get("pcs_anon"), "Anonym-Cookie wird gesetzt");

    // Foto liegt wirklich (als JPEG) auf der Platte
    const img = await session.inject(app, { method: "GET", url: scan.imageUrl });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers["content-type"], "image/jpeg");

    // Aufraeumen
    const del = await session.inject(app, { method: "DELETE", url: `/scans/${scan.id}` });
    assert.equal(del.statusCode, 200);
  } finally {
    restore();
    await app.close();
  }
});

test("fremde Scans sind nicht sichtbar (kein Cookie -> 404)", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const owner = new Session();
  try {
    const created = await uploadScan(app, owner);
    const id = created.json().id;

    const stranger = new Session();
    const peek = await stranger.inject(app, { method: "GET", url: `/scans/${id}` });
    assert.equal(peek.statusCode, 404);
    const del = await stranger.inject(app, { method: "DELETE", url: `/scans/${id}` });
    assert.equal(del.statusCode, 404);

    await owner.inject(app, { method: "DELETE", url: `/scans/${id}` });
  } finally {
    await app.close();
  }
});

test("POST /scans ohne Auto-Save bleibt pending", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const res = await uploadScan(app, session, {
      ...CANNED,
      autoSave: false,
      reason: "Score zu niedrig (final=0.62 < 0.85)",
    });
    assert.equal(res.statusCode, 201);
    const scan = res.json();
    assert.equal(scan.status, "pending");
    assert.equal(scan.chosenCardId, null);
    await session.inject(app, { method: "DELETE", url: `/scans/${scan.id}` });
  } finally {
    await app.close();
  }
});

test("PATCH /scans/:id kann bestaetigen und korrigieren", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const res = await uploadScan(app, session, { ...CANNED, autoSave: false });
    const scan = res.json();

    // bestaetigen (Kandidat 1)
    const ok = await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scan.id}`,
      payload: { action: "confirm", cardId: "base1-4" },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().status, "confirmed");
    assert.equal(ok.json().chosenCardId, "base1-4");

    // korrigieren auf andere Karte
    const fixed = await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scan.id}`,
      payload: { action: "correct", cardId: "base1-58" },
    });
    assert.equal(fixed.statusCode, 200);
    assert.equal(fixed.json().status, "corrected");
    assert.equal(fixed.json().chosenCardId, "base1-58");

    // verwerfen
    const rejected = await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scan.id}`,
      payload: { action: "reject" },
    });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json().status, "rejected");

    // unbekannte Karte -> 400
    const bad = await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scan.id}`,
      payload: { action: "confirm", cardId: "gibt-es-nicht-999" },
    });
    assert.equal(bad.statusCode, 400);

    // unbekannte Aktion -> 400
    const badAction = await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scan.id}`,
      payload: { action: "loeschen" },
    });
    assert.equal(badAction.statusCode, 400);

    await session.inject(app, { method: "DELETE", url: `/scans/${scan.id}` });
  } finally {
    await app.close();
  }
});

test("POST /scans validiert das Bild (400) und meldet rec-Ausfall (503)", { skip }, async () => {
  const restoreHtml = stubRec();
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    // kein Bild
    const empty = await session.inject(app, {
      method: "POST",
      url: "/scans",
      headers: { "content-type": "multipart/form-data; boundary=X" },
      payload: multipartBody(Buffer.from("<html>kein bild</html>"), "scan.jpg"),
    });
    assert.equal(empty.statusCode, 400);
    assert.match(empty.json().error, /Kein gueltiges Bild/);
  } finally {
    restoreHtml();
    await app.close();
  }

  // rec-Service faellt aus -> 503 (kein falscher Treffer, klare Fehlermeldung)
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as typeof fetch;
  const app2 = await buildApp({ logger: false, rateLimit: false });
  try {
    const res = await new Session().inject(app2, {
      method: "POST",
      url: "/scans",
      headers: { "content-type": "multipart/form-data; boundary=X" },
      payload: multipartBody(await jpeg()),
    });
    assert.equal(res.statusCode, 503);
    // Nach aussen nur ein kurzer Hinweis - keine internen Fehlerdetails
    // (Netzwerkfehler, Hostnamen oder Ports des Erkennungs-Dienstes).
    assert.match(res.json().error, /Erkennung fehlgeschlagen/);
    assert.doesNotMatch(res.json().error, /ECONNREFUSED|localhost|:8000/);
  } finally {
    globalThis.fetch = original;
    await app2.close();
  }
});

test("GET /cards/search findet Karten und /cards/:id/image liefert JPEG", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  try {
    const res = await app.inject({ method: "GET", url: "/cards/search?q=Glurak&limit=5" });
    assert.equal(res.statusCode, 200);
    const { results } = res.json();
    assert.ok(results.length > 0, "Suche sollte Treffer liefern");
    assert.ok(
      results.some((c: any) => (c.nameDe ?? "").toLowerCase().includes("glurak")),
      "Treffer enthaelt den Suchbegriff",
    );

    // zu kurzer Suchbegriff -> keine Ergebnisse (verhindert Volltabellen-Scan)
    const short = await app.inject({ method: "GET", url: "/cards/search?q=g" });
    assert.deepEqual(short.json().results, []);

    const image = await app.inject({ method: "GET", url: "/cards/base1-4/image" });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/jpeg");
    assert.ok(image.rawPayload.length > 1000, "echtes Bild erwartet");

    // Karte ohne ID -> 404
    const missing = await app.inject({ method: "GET", url: "/cards/gibt-es-nicht-999/image" });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("GET /scans?status= filtert nach Status", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const created = await uploadScan(app, session); // autoSave -> Status "auto"
    assert.equal(created.json().status, "auto");

    const res = await session.inject(app, { method: "GET", url: "/scans?limit=5&status=auto" });
    assert.equal(res.statusCode, 200);
    const { scans: list } = res.json();
    assert.ok(list.length > 0);
    assert.ok(list.every((s: any) => s.status === "auto"));

    const pending = await session.inject(app, { method: "GET", url: "/scans?status=pending" });
    assert.equal(pending.json().scans.length, 0);

    await session.inject(app, { method: "DELETE", url: `/scans/${created.json().id}` });
  } finally {
    await app.close();
  }
});

test("Rate-Limit greift auf POST /scans (20/min pro IP)", async () => {
  const app = await buildApp({ logger: false });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/scans",
        headers: { "content-type": "multipart/form-data; boundary=X" },
        payload: Buffer.from("--X--\r\n"),
      });
      codes.push(res.statusCode);
    }
    assert.ok(
      codes.slice(0, 20).every((c) => c === 400 || c === 415),
      `erste 20 Anfragen normal: ${codes.join(",")}`,
    );
    assert.equal(codes[20], 429, `21. Anfrage muss begrenzt werden: ${codes.join(",")}`);
  } finally {
    await app.close();
  }
});

test("Rate-Limit zählt pro Client-IP, auch hinter dem Reverse-Proxy", async () => {
  // Ohne trustProxy sieht die API nur die Proxy-IP - alle Nutzer teilen sich
  // dann ein Budget (und ein Angreifer sperrt alle aus).
  const app = await buildApp({ logger: false });
  const call = (ip: string) =>
    app.inject({
      method: "POST",
      url: "/scans",
      headers: {
        "content-type": "multipart/form-data; boundary=X",
        "x-forwarded-for": ip,
      },
      payload: Buffer.from("--X--\r\n"),
    });
  try {
    for (let i = 0; i < 20; i++) await call("203.0.113.10");
    const limited = await call("203.0.113.10");
    assert.equal(limited.statusCode, 429, "21. Anfrage derselben IP muss begrenzt werden");

    const other = await call("203.0.113.11");
    assert.ok(
      other.statusCode === 400 || other.statusCode === 415,
      `andere IP hat ein eigenes Budget (Status ${other.statusCode})`,
    );
  } finally {
    await app.close();
  }
});
