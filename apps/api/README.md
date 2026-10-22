# PCS API (Fastify)

Öffentliche API des Karten-Scanners. Sie hält den Katalog (aus der Datenbank),
nimmt Scan-Fotos entgegen, lässt sie vom Erkennungs-Service bewerten und speichert
das Ergebnis inklusive Kandidaten als **Feedback für die Kalibrierung**.

## Endpunkte

### Karten & Scans

| Methode | Pfad                           | Beschreibung                                                         |
| ------- | ------------------------------ | -------------------------------------------------------------------- |
| GET     | `/health`                      | Status der API + Erkennungs-Service (Indexgrößen)                    |
| POST    | `/scans`                       | Multipart `image` (≤ 15 MB, JPEG/PNG/WebP) → Kandidaten + `autoSave` |
| GET     | `/scans?limit=&status=`        | eigene Scans (Verlauf)                                               |
| GET     | `/scans/:id`                   | Scan + aufgelöste Kartendaten (Referenzbilder)                       |
| PATCH   | `/scans/:id`                   | Feedback: `{action: "confirm"｜"correct"｜"reject", cardId?}`        |
| GET     | `/scans/:id/image`             | hochgeladenes Foto                                                   |
| DELETE  | `/scans/:id`                   | Scan + Foto löschen (DSGVO)                                          |
| GET     | `/cards/search?q=&limit=&set=` | manuelle Suche (Name de/en oder Nummer)                              |
| GET     | `/cards/:tcgdexId`             | Kartendetail                                                         |
| GET     | `/cards/:tcgdexId/image`       | Referenzbild aus dem lokalen Cache                                   |

### Anmeldung (`/auth`)

| Methode | Pfad             | Beschreibung                                                                           |
| ------- | ---------------- | -------------------------------------------------------------------------------------- |
| POST    | `/auth/register` | `{email, password, displayName?}` → 201 + Sitzungscookie                               |
| POST    | `/auth/login`    | `{email, password}` → 200 + Sitzungscookie                                             |
| POST    | `/auth/logout`   | Sitzung beenden, Cookie löschen (204)                                                  |
| GET     | `/auth/me`       | `{user: AuthUser \| null}`                                                             |
| PATCH   | `/auth/me`       | `{displayName?, password?, currentPassword?}` (Passwortwechsel beendet alle Sitzungen) |

Passwörter werden mit **Argon2id** gehasht (`@node-rs/argon2`, 19 MiB, t=2, p=1).
Die Sitzung liegt in einem httpOnly-Cookie `pcs_session` (SameSite=Lax, 30 Tage,
sliding renewal bei < 15 Tagen Restlaufzeit); in der DB steht nur der SHA-256-Hash
des Tokens. Login antwortet bei unbekannter E-Mail und falschem Passwort identisch
(`fakeVerify` gleicht das Zeitverhalten an), damit sich Konten nicht aufzählen lassen.
Beim Anmelden werden **anonyme Scans dieses Browsers** übernommen
(`pcs_anon`-Cookie → `user_id`).

### Sammlung (`/collection`) – erfordert Anmeldung (sonst 401)

| Methode | Pfad                                            | Beschreibung                                                                         |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| POST    | `/collection`                                   | `{cardId, quantity?, condition?, language?, notes?}` → legt an bzw. erhöht die Menge |
| GET     | `/collection?q=&set=&condition=&limit=&offset=` | eigene Karten (neueste Änderung zuerst)                                              |
| GET     | `/collection/stats`                             | Summen, Zustände, Top-Sets                                                           |
| GET     | `/collection/has?ids=a,b,c`                     | „habe ich schon" für bis zu 100 Karten                                               |
| PATCH   | `/collection/:id`                               | `{quantity?, condition?, language?, notes?}`                                         |
| DELETE  | `/collection/:id`                               | Eintrag löschen                                                                      |

Regeln: genau **ein Eintrag je (Nutzer, Karte, Zustand)** – erneutes Hinzufügen
erhöht die Menge, ein Zustandswechsel auf einen bestehenden Eintrag führt beide
zusammen. Zustände: `mint`, `near_mint` (Standard), `excellent`, `good`, `played`,
`poor`.

Nach außen werden ausschließlich **TCGdex-IDs** verwendet (z. B. `base1-4`), nie
Datenbank-UUIDs (Ausnahme: die ID eines Sammlungseintrags). Die API prüft
Referenzbilder per Magic-Bytes, damit niemals eine zwischengespeicherte
HTML-Fehlerseite als Bild ausgeliefert wird.

## Scans → Sammlung

- Anonyme Scans gehören dem Browser (`pcs_anon`), angemeldete Scans dem Konto.
  Fremde Scans liefern `404`; ohne Cookie ist der Verlauf leer.
- Ein **Auto-Scan** (Konsens) landet bei angemeldeten Nutzern sofort in der Sammlung.
- Bestätigen derselben Karte zählt nicht doppelt; eine **Korrektur** nimmt die zuvor
  hinterlegte (falsch erkannte) Karte wieder heraus und legt die gewählte an;
  **Verwerfen** entfernt die automatisch übernommene Karte wieder.

## Verhalten bei Fehlern

| Fall                                                         | Antwort                   |
| ------------------------------------------------------------ | ------------------------- |
| Feld `image` fehlt / leer / kein Bild (Magic-Bytes)          | `400` mit Klartextmeldung |
| Erkennungs-Service nicht erreichbar                          | `503`                     |
| Erkennungs-Service antwortet mit Fehler                      | `502`                     |
| Unbekannte Karte im Feedback                                 | `400`                     |
| Zu viele Scan-Anfragen (> 20/min pro IP)                     | `429`                     |
| Sammlung ohne Anmeldung                                      | `401`                     |
| E-Mail ungültig / Passwort < 8 Zeichen                       | `400`                     |
| E-Mail schon registriert                                     | `409`                     |
| Login fehlgeschlagen (gleiche Meldung für unbekannte E-Mail) | `401`                     |
| Schreibende Anfrage von fremder Origin (CSRF)                | `403`                     |

## Datenmodell (Auszug)

- `sets`, `cards` – Katalog aus TCGdex (`name_de`, `name_en`, `number`, `local_image_path` …)
- `scans` – jeder Scan: Status (`pending`/`auto`/`confirmed`/`corrected`/`rejected`),
  Foto-Pfad, Kandidaten (JSON inkl. Scores je Verfahren), `auto_card_id`, `chosen_card_id`,
  `reason`, `quality`, `elapsed_ms`, `user_id` (nullable) bzw. `anon_id`
- `users`, `sessions` – Konten (Argon2id-Hash) und Sitzungen (Token-Hash, Ablauf)
- `collection_items` – Sammlung je Nutzer, eindeutig über (Nutzer, Karte, Zustand)
- `sync_jobs` – Protokoll der Sync-Läufe

## Entwicklung

```bash
npm run dev:api          # tsx watch, liest .env aus der Repo-Wurzel
npm run test:api         # 26 Tests (node:test + tsx), braucht die lokale DB
npx --yes tsc --noEmit -p tsconfig.json
```

Migrationen (Drizzle):

```bash
cd apps/api
npx --yes drizzle-kit generate   # aus src/db/schema.ts
npx --yes drizzle-kit migrate    # auf die lokale DB anwenden
```

Hinweis: `src/db/migrations/0000_init_sync.sql` ist handgeschrieben, der zugehörige
Snapshot liegt in `meta/` – neue Migrationen erzeugen daher nur noch das Delta.

## Produktions-Betrieb

Im Container läuft die API unter **reinem Node** (`node dist/main.js`, kein tsx).
Daraus folgen zwei Dinge:

1. **Keine Laufzeit-Importe aus `@shared/types`.** Das Paket liefert TypeScript-Quellen,
   die Node nicht laden kann. `import type` ist unproblematisch (tsc entfernt es);
   Werte, die die API braucht, werden lokal abgeleitet (z. B. `CARD_CONDITIONS` aus
   dem Drizzle-Enum in `src/lib/collection.ts`). Der Build prüft das und bricht bei
   einem Verstoß ab (`scripts/verify-dist.mjs`, Teil von `npm run build`).
2. **Migrationen und Ordner** müssen im Build liegen: `tsc` kopiert die `.sql`-Dateien
   nicht, deshalb legt das Dockerfile `src/db/migrations` nach `dist/db/migrations`
   (`src/db/migrations-path.ts` findet den Ordner in beiden Varianten).
   Manuell anwenden geht mit `npm run db:migrate:dist`.

```bash
npm run build                 # tsc + Prüfung auf unerlaubte Importe (apps/api/dist)
MIGRATE_ON_START=1 node dist/main.js   # Migrationen beim Start (Standard im Container)
NODE_ENV=production           # Cookies mit Secure + CORS über CORS_ORIGINS
```

Voraussetzung im Betrieb: `DATABASE_URL`, `COOKIE_SECRET`, `REC_URL`; Schreibrechte
auf `UPLOADS_DIR` und lesend auf `REF_CACHE_DIR`. Die vollständige Anleitung
(Stack, TLS, Backup, Fehlersuche) steht in [`DEPLOYMENT.md`](../../DEPLOYMENT.md).
