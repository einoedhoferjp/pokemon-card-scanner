// Tests der Sammlung: Anlegen, Menge erhoehen, Zustand wechseln (Merge),
// Filtern, Statistik, Loeschen, Uebernahme beim Bestaetigen eines Scans.

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

test("Sammlung erfordert Anmeldung (401)", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    for (const req of [
      { method: "GET" as const, url: "/collection" },
      { method: "GET" as const, url: "/collection/stats" },
      { method: "POST" as const, url: "/collection", payload: { cardId: "base1-4" } },
    ]) {
      const res = await session.inject(app, req);
      assert.equal(res.statusCode, 401, `${req.method} ${req.url}`);
    }
  } finally {
    await app.close();
  }
});

test("Karte hinzufuegen erhoeht die Menge, Zustandswechsel fuehrt zusammen", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    await registerUser(app, session);

    const first = await session.inject(app, {
      method: "POST",
      url: "/collection",
      payload: { cardId: "base1-4" },
    });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().quantity, 1);
    assert.equal(first.json().condition, "near_mint");
    assert.equal(first.json().card.tcgdexId, "base1-4");
    assert.equal(first.json().card.nameDe, "Glurak");
    assert.ok(first.json().card.imageUrl.startsWith("/cards/"));
    const itemId = first.json().id;

    // gleiche Karte, gleicher Zustand -> Menge + 2
    const again = await session.inject(app, {
      method: "POST",
      url: "/collection",
      payload: { cardId: "base1-4", quantity: 2 },
    });
    assert.equal(again.statusCode, 201);
    assert.equal(again.json().id, itemId, "kein zweiter Eintrag");
    assert.equal(again.json().quantity, 3);

    // zweiter Zustand -> eigener Eintrag
    const mint = await session.inject(app, {
      method: "POST",
      url: "/collection",
      payload: { cardId: "base1-4", condition: "mint" },
    });
    assert.equal(mint.statusCode, 201);
    assert.notEqual(mint.json().id, itemId);

    // "mint" in "near_mint" umwandeln -> zusammenfuehren (3 + 1)
    const merged = await session.inject(app, {
      method: "PATCH",
      url: `/collection/${mint.json().id}`,
      payload: { condition: "near_mint" },
    });
    assert.equal(merged.statusCode, 200);
    assert.equal(merged.json().id, itemId);
    assert.equal(merged.json().quantity, 4);

    // Menge setzen + Notiz
    const patched = await session.inject(app, {
      method: "PATCH",
      url: `/collection/${itemId}`,
      payload: { quantity: 5, notes: "Erste Edition" },
    });
    assert.equal(patched.json().quantity, 5);
    assert.equal(patched.json().notes, "Erste Edition");

    // ungültiger Zustand -> 400
    const bad = await session.inject(app, {
      method: "PATCH",
      url: `/collection/${itemId}`,
      payload: { condition: "zerkratzt" },
    });
    assert.equal(bad.statusCode, 400);

    // unbekannte Karte -> 400
    const unknown = await session.inject(app, {
      method: "POST",
      url: "/collection",
      payload: { cardId: "gibt-es-nicht-999" },
    });
    assert.equal(unknown.statusCode, 400);

    // Liste + Suche + Statistik
    await session.inject(app, {
      method: "POST",
      url: "/collection",
      payload: { cardId: "base1-58" },
    });

    const list = await session.inject(app, { method: "GET", url: "/collection" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().total, 2);
    assert.equal(list.json().totalCards, 6, "5 Glurak + 1 Pikachu");

    const search = await session.inject(app, { method: "GET", url: "/collection?q=pikachu" });
    assert.equal(search.json().items.length, 1);
    assert.equal(search.json().items[0].card.tcgdexId, "base1-58");

    const stats = await session.inject(app, { method: "GET", url: "/collection/stats" });
    assert.equal(stats.statusCode, 200);
    assert.equal(stats.json().uniqueCards, 2);
    assert.equal(stats.json().totalCards, 6);
    assert.equal(stats.json().byCondition.length, 1);
    assert.ok(stats.json().topSets.some((s: any) => s.setId === "base1"));

    // "habe ich schon"
    const has = await session.inject(app, {
      method: "GET",
      url: "/collection/has?ids=base1-4,base1-58,base1-1",
    });
    assert.equal(has.json().owned.length, 2);

    // fremde Sitzung sieht nichts
    const stranger = new Session();
    await registerUser(app, stranger);
    const strangerList = await stranger.inject(app, { method: "GET", url: "/collection" });
    assert.equal(strangerList.json().items.length, 0);
    const strangerDelete = await stranger.inject(app, {
      method: "DELETE",
      url: `/collection/${itemId}`,
    });
    assert.equal(strangerDelete.statusCode, 404);

    // loeschen
    const del = await session.inject(app, { method: "DELETE", url: `/collection/${itemId}` });
    assert.equal(del.statusCode, 200);
    const after = await session.inject(app, { method: "GET", url: "/collection" });
    assert.equal(after.json().total, 1);
  } finally {
    await app.close();
  }
});

test("Bestaetigter Scan landet in der Sammlung (einmalig)", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  try {
    await registerUser(app, session);

    const created = await uploadScan(app, session, { ...CANNED, autoSave: false });
    const scanId = created.json().id;

    const confirm = await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scanId}`,
      payload: { action: "confirm", cardId: "base1-4" },
    });
    assert.equal(confirm.statusCode, 200);

    let list = await session.inject(app, { method: "GET", url: "/collection" });
    assert.equal(list.json().items.length, 1);
    assert.equal(list.json().items[0].card.tcgdexId, "base1-4");
    assert.equal(list.json().items[0].quantity, 1);

    // erneutes Bestaetigen derselben Karte erhoeht die Menge nicht
    await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scanId}`,
      payload: { action: "confirm", cardId: "base1-4" },
    });
    list = await session.inject(app, { method: "GET", url: "/collection" });
    assert.equal(list.json().items[0].quantity, 1, "keine Doppelzaehlung");

    // Korrektur auf eine andere Karte tauscht den Eintrag (die erste wird zurueckgenommen)
    await session.inject(app, {
      method: "PATCH",
      url: `/scans/${scanId}`,
      payload: { action: "correct", cardId: "base1-58" },
    });
    list = await session.inject(app, { method: "GET", url: "/collection" });
    assert.equal(list.json().items.length, 1);
    assert.equal(list.json().items[0].card.tcgdexId, "base1-58");

    await session.inject(app, { method: "DELETE", url: `/scans/${scanId}` });
  } finally {
    await app.close();
  }
});

test(
  "Auto-Scan: Bestaetigen zaehlt nicht doppelt, Korrektur tauscht die Karte",
  { skip },
  async () => {
    const app = await buildApp({ logger: false, rateLimit: false });
    const session = new Session();
    try {
      await registerUser(app, session);

      // Auto-Erkennung (Konsens) -> Karte liegt sofort in der Sammlung
      const created = await uploadScan(app, session);
      const scanId = created.json().id;
      assert.equal(created.json().status, "auto");

      let list = await session.inject(app, { method: "GET", url: "/collection" });
      assert.equal(list.json().items[0].quantity, 1);

      // Bestaetigen der automatischen Zuordnung darf nicht erhoehen
      await session.inject(app, {
        method: "PATCH",
        url: `/scans/${scanId}`,
        payload: { action: "confirm", cardId: "base1-4" },
      });
      list = await session.inject(app, { method: "GET", url: "/collection" });
      assert.equal(list.json().items.length, 1);
      assert.equal(list.json().items[0].quantity, 1, "keine Doppelzaehlung beim Bestaetigen");

      // Korrektur auf eine andere Karte: falsche Karte verschwindet, neue kommt dazu
      await session.inject(app, {
        method: "PATCH",
        url: `/scans/${scanId}`,
        payload: { action: "correct", cardId: "base1-58" },
      });
      list = await session.inject(app, { method: "GET", url: "/collection" });
      assert.equal(list.json().items.length, 1, "falsch erkannte Karte wurde zurueckgenommen");
      assert.equal(list.json().items[0].card.tcgdexId, "base1-58");
      assert.equal(list.json().items[0].quantity, 1);

      // Verwerfen entfernt die automatisch uebernommene Karte wieder
      await session.inject(app, {
        method: "PATCH",
        url: `/scans/${scanId}`,
        payload: { action: "reject" },
      });
      list = await session.inject(app, { method: "GET", url: "/collection" });
      assert.equal(list.json().items.length, 0, "verworfener Scan raeumt die Sammlung auf");

      await session.inject(app, { method: "DELETE", url: `/scans/${scanId}` });
    } finally {
      await app.close();
    }
  },
);

test("Auto-Scan (Konsens) landet direkt in der Sammlung, anonym nicht", { skip }, async () => {
  const app = await buildApp({ logger: false, rateLimit: false });
  const session = new Session();
  const anon = new Session();
  try {
    // anonym: kein Konto -> keine Sammlung, aber der Scan bleibt sichtbar
    const anonScan = await uploadScan(app, anon);
    assert.equal(anonScan.json().status, "auto");
    assert.equal((await anon.inject(app, { method: "GET", url: "/collection" })).statusCode, 401);

    await registerUser(app, session);
    const mine = await uploadScan(app, session);
    assert.equal(mine.json().status, "auto");

    const list = await session.inject(app, { method: "GET", url: "/collection" });
    assert.equal(list.json().items.length, 1);
    assert.equal(list.json().items[0].card.tcgdexId, "base1-4");

    await session.inject(app, { method: "DELETE", url: `/scans/${mine.json().id}` });
    await anon.inject(app, { method: "DELETE", url: `/scans/${anonScan.json().id}` });
  } finally {
    await app.close();
  }
});
