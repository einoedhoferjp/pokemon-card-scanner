// Tests der Anmeldung (Registrierung, Login, Logout, Profil, Uebernahme
// anonymer Scans). Braucht die lokale DB, sonst uebersprungen.

import "../src/env.js";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { count } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { closeDb, db } from "../src/db/client.js";
import { cards } from "../src/db/schema.js";
import { CANNED, Session, cleanupTestData, registerUser, uploadScan } from "./support.js";

after(async () => {
  await cleanupTestData();
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

test("Registrierung, Sitzung und Abmelden", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const user = await registerUser(app, session);
    assert.ok(session.get("pcs_session"), "Sitzungscookie gesetzt");

    const me = await session.inject(app, { method: "GET", url: "/auth/me" });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, user.email);
    assert.equal(me.json().user.displayName, "Testnutzer");
    assert.ok(!("passwordHash" in me.json().user), "Passwort-Hash wird nie ausgeliefert");

    const other = new Session();
    const anonMe = await other.inject(app, { method: "GET", url: "/auth/me" });
    assert.equal(anonMe.json().user, null);

    // Abmelden beendet die Sitzung wirklich (Token ungueltig)
    const out = await session.inject(app, { method: "POST", url: "/auth/logout" });
    assert.equal(out.statusCode, 204);
    const meAfter = await session.inject(app, { method: "GET", url: "/auth/me" });
    assert.equal(meAfter.json().user, null);
  } finally {
    await app.close();
  }
});

test("Registrierung validiert E-Mail und Passwort", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const badEmail = await session.inject(app, {
      method: "POST",
      url: "/auth/register",
      payload: { email: "keine-mail", password: "geheim1234" },
    });
    assert.equal(badEmail.statusCode, 400);

    const shortPw = await session.inject(app, {
      method: "POST",
      url: "/auth/register",
      payload: { email: "test-kurz@example.com", password: "kurz" },
    });
    assert.equal(shortPw.statusCode, 400);
    assert.match(shortPw.json().error, /mindestens 8/);

    // doppelte Registrierung
    const user = await registerUser(app, new Session());
    const again = await session.inject(app, {
      method: "POST",
      url: "/auth/register",
      payload: { email: user.email, password: "geheim1234" },
    });
    assert.equal(again.statusCode, 409);
  } finally {
    await app.close();
  }
});

test(
  "Login: falsches Passwort wird abgelehnt, richtiges akzeptiert (case-insensitive E-Mail)",
  { skip },
  async () => {
    const app = await buildApp({ logger: false, rateLimit: false });
    try {
      const user = await registerUser(app, new Session());

      const wrong = new Session();
      const bad = await wrong.inject(app, {
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password: "falschfalsch" },
      });
      assert.equal(bad.statusCode, 401);
      assert.ok(!wrong.get("pcs_session"), "kein Sitzungscookie bei Fehlschlag");
      // gleiche Meldung wie bei unbekannter E-Mail (keine Nutzer-Enumeration)
      const unknown = await new Session().inject(app, {
        method: "POST",
        url: "/auth/login",
        payload: { email: "test-gibtsnicht@example.com", password: "geheim1234" },
      });
      assert.equal(unknown.statusCode, 401);
      assert.equal(unknown.json().error, bad.json().error);

      const good = new Session();
      const ok = await good.inject(app, {
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email.toUpperCase(), password: user.password },
      });
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(ok.json().user.email, user.email);
      assert.ok(good.get("pcs_session"));
    } finally {
      await app.close();
    }
  },
);

test("Profil aendern: Anzeigename und Passwort (mit aktuellem Passwort)", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    const user = await registerUser(app, session);

    const named = await session.inject(app, {
      method: "PATCH",
      url: "/auth/me",
      payload: { displayName: "  Sammlerin  " },
    });
    assert.equal(named.statusCode, 200);
    assert.equal(named.json().user.displayName, "Sammlerin");

    // falsches aktuelles Passwort
    const bad = await session.inject(app, {
      method: "PATCH",
      url: "/auth/me",
      payload: { password: "neuespasswort1", currentPassword: "falsch" },
    });
    assert.equal(bad.statusCode, 400);

    const changed = await session.inject(app, {
      method: "PATCH",
      url: "/auth/me",
      payload: { password: "neuespasswort1", currentPassword: user.password },
    });
    assert.equal(changed.statusCode, 200);

    // alte Sitzung wurde beendet, die neue Sitzung aus der Antwort gilt
    const newLogin = new Session();
    const oldPw = await newLogin.inject(app, {
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: user.password },
    });
    assert.equal(oldPw.statusCode, 401);
    const newPw = await newLogin.inject(app, {
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: "neuespasswort1" },
    });
    assert.equal(newPw.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("anonyme Scans werden beim Login uebernommen", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    // anonym scannen
    const created = await uploadScan(app, session, { ...CANNED, autoSave: false });
    assert.equal(created.statusCode, 201);
    const scanId = created.json().id;

    const before = await session.inject(app, { method: "GET", url: "/scans" });
    assert.equal(before.json().scans.length, 1);

    // Konto mit demselben Browser (gleiches Cookie-Glas) anlegen
    const user = await registerUser(app, session);
    assert.equal(
      (await session.inject(app, { method: "GET", url: "/scans" })).json().scans.length,
      1,
      "Scan gehoert jetzt dem Konto",
    );

    // Der Scan ist dem Nutzer zugeordnet (kein anonId mehr) und weiter abrufbar
    const detail = await session.inject(app, { method: "GET", url: `/scans/${scanId}` });
    assert.equal(detail.statusCode, 200);

    // Ein frischer Browser sieht nichts
    const stranger = new Session();
    assert.equal(
      (await stranger.inject(app, { method: "GET", url: "/scans" })).json().scans.length,
      0,
    );

    await session.inject(app, { method: "DELETE", url: `/scans/${scanId}` });
    assert.ok(user.id);
  } finally {
    await app.close();
  }
});
