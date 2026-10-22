# Pokémon-Karten-Scanner (PWA)

Karten mit dem Handy fotografieren, automatisch erkennen und in die eigene Sammlung
übernehmen – **ohne dass je eine Karte stillschweigend falsch gespeichert wird**.

Der Scanner kombiniert vier Verfahren und lässt sie sich gegenseitig bestätigen
(Konsens): **pHash** (Bild-Hash), **DINOv2-Embeddings** (Bildähnlichkeit),
**OCR** (Kartenname + Nummer) und **Set-/Nummern-Abgleich** gegen den TCGdex-Katalog.
Nur wenn mehrere Verfahren unabhängig übereinstimmen, wird automatisch gespeichert.
Sonst bekommt die Nutzerin die Top-3-Kandidaten mit Referenzbild zur Bestätigung –
plus manuelle Suche als Fallback.

> Pokémon ist eine Marke von Nintendo / The Pokémon Company. Dies ist ein privates
> Projekt ohne kommerzielle Absicht.

## Status

| Schritt | Inhalt                                         | Stand                                                                                         |
| ------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1       | Kartendatenbank-Sync (TCGdex + Referenzbilder) | ✅ 20.232 Karten, 155 Sets, 17.085 Referenzbilder                                             |
| 2       | Erkennungs-Service + Evaluation                | ✅ Top-1 87 %, Falsch-Auto 0 %                                                                |
| 3       | Kamera-Scan-Frontend (PWA)                     | ✅ Scan, Top-3, Referenzvergleich, manuelle Suche, Verlauf                                    |
| 4       | Anmeldung & Sammlung pro Nutzer                | ✅ Registrieren/Anmelden, Sammlung, anonyme Scans werden übernommen                           |
| 5       | PWA-Offline & Feinschliff                      | ✅ App-Shell offline, Referenzbilder im Cache, Installation, Lighthouse 94/100/100/100        |
| 6       | Docker-Compose-Deployment mit HTTPS            | ✅ Ein Image-Stack, Caddy (TLS + eine Herkunft), Rauchtests, [`DEPLOYMENT.md`](DEPLOYMENT.md) |

## Architektur

```text
        Handy / Browser (PWA)
                │  https
                ▼
     apps/web   React + TS + Vite + Tailwind   :5173
                │  /scans, /cards, /scans/:id  (JSON + Bild-Upload)
                ▼
     apps/api   Fastify + Drizzle               :3000
                │  • Bildprüfung, EXIF-Entfernung (sharp)
                │  • Katalog-Suche, Referenzbilder, Scan-Verlauf
                │  • Konten/Sitzungen (Argon2id), Sammlung pro Nutzer
                │  • Rate-Limit, Upload-Limits, CSRF-Origin-Prüfung
                ▼  interne Anfrage (multipart)
     apps/rec   FastAPI + PaddleOCR + ONNX      :8000
                │  • Kartenerkennung, Perspektivkorrektur
                │  • pHash, DINOv2-Embeddings, OCR, Konsens-Fusion
                ▼
   PostgreSQL 16 + pgvector  (Katalog, Scans, Konten, Sammlung)   :5433
```

Im Betrieb (Schritt 6) steht davor ein **Caddy-Container** (`deploy/`). Er liefert
die gebaute PWA aus und leitet `/cards*`, `/scans*`, `/collection*`, `/auth*` und
`/health` an die API weiter. Dadurch liegen Web und API auf **einer** Herkunft:
kein CORS, erst-parteiische Cookies, `Secure` funktioniert. Details und Befehle:
[`DEPLOYMENT.md`](DEPLOYMENT.md).

Komponenten:

- **apps/api** – öffentliche API. Kennt die Karten-DB, nimmt Fotos an, ruft den
  Erkennungs-Service, speichert Scans (Feedback-Schleife für die Kalibrierung),
  verwaltet Konten, Sitzungen und die Sammlung pro Nutzer.
- **apps/rec** – Erkennungs-Service (Python). Enthält die eigentliche Bildverarbeitung
  und die Evaluation. Details: [`apps/rec/README.md`](apps/rec/README.md).
- **apps/web** – PWA-Frontend (deutsch, umschaltbar auf Englisch) mit Scan, Verlauf,
  Sammlung und Anmeldung.
- **packages/shared** – gemeinsame TypeScript-Typen.

## Anmeldung und Sammlung

- **Ohne Konto** lässt sich scannen und der Verlauf nutzen – er hängt dann an einem
  anonymen Browser-Cookie (`pcs_anon`), nicht an einer Person.
- **Mit Konto** werden beim Anmelden die vorhandenen anonymen Scans dieses Browsers
  übernommen. Automatisch erkannte (Konsens) und bestätigte Karten landen in der
  Sammlung: Menge je Karte und Zustand (`mint` … `poor`).
- **Korrektur/Verwerfen** hält die Sammlung sauber: eine falsch automatisch übernommene
  Karte wird wieder herausgenommen, mehrfaches Bestätigen zählt nicht doppelt.
- Passwörter: Argon2id; die Sitzung liegt in einem httpOnly-Cookie (30 Tage),
  in der DB steht nur der Token-Hash. Fremde Scans/Sammlungen liefern `404`/`401`.

## PWA und Offline

- **App-Shell offline:** Der Service Worker legt HTML/JS/CSS und Icons vorab ab
  (`workbox`), die App startet also auch ohne Netz (Startseite, Rahmen, Hinweise).
- **Referenzbilder im Cache:** Katalogbilder (`/cards/*/image`, 600 Einträge,
  60 Tage) kommen zuerst aus dem Cache, Kartendaten (Suche/Detail) über
  „erst Netz, sonst Cache“ (5 s Zeitlimit, 14 Tage). Konten, Scans und Sammlung
  werden **nie** gecacht – fremde Daten sollen nicht im Browser liegen bleiben.
- **Ohne Netz:** Banner „Keine Verbindung“, Auslöser und Galerie sind gesperrt;
  Netzwerkfehler werden als „Keine Verbindung zum Server“ angezeigt statt als
  „Failed to fetch“. Scannen selbst braucht den Server (OCR + Bildvergleich) –
  eine Offline-Warteschlange für Fotos ist bewusst **nicht** dabei (siehe unten).
- **Installation:** „Zum Startbildschirm hinzufügen“ – Chrome/Edge/Android über
  `beforeinstallprompt`, iOS über einen Hinweis („Teilen → Zum Home-Bildschirm“).
  Der Hinweis lässt sich dauerhaft wegklicken. Updates laufen automatisch
  (`registerType: autoUpdate`).
- **Lighthouse** (gebauter Stand, `npm run lighthouse`): Performance 94,
  Accessibility 100, Best Practices 100, SEO 100. Einzige offene Prüfung ist
  `bf-cache`: der Browser schließt die Kamera-Berechtigung aus dem
  Zurück/Vorwärts-Cache aus („Pending browser support“, nicht behebbar).

## iOS-App (AltStore)

Wer eine installierbare App statt „Zum Home-Bildschirm“ möchte: GitHub Actions
baut auf einem macOS-Runner eine unsignierte `.ipa`, die AltStore beim
Installieren mit der eigenen Apple-ID signiert. Die App ist eine native Hülle
(Capacitor, WKWebView) und lädt dieselbe PWA über HTTPS – Änderungen an der
Web-App brauchen keinen neuen Build.

1. Actions → **iOS-App (IPA)** → _Run workflow_ → `app_url` (HTTPS-Adresse der
   Installation) eintragen.
2. Nach dem Lauf (ca. 3 Minuten) die `.ipa` direkt herunterladen:
   `…/releases/download/ios-v<version>/PK-Scan.ipa` – zusätzlich liegt sie als
   Artefakt `PK-Scan-ipa` am Lauf. Das Repository ist öffentlich, weil macOS-Runner
   nur dort kostenlos sind (Details: [IOS.md](IOS.md#1-repository-zu-github)).
3. `.ipa` per AltStore installieren, beim ersten Start der Apple-ID vertrauen.

Details, Grenzen und Fehlerbehebung: [IOS.md](IOS.md).

## Deployment (Docker Compose mit HTTPS)

Vier Container: **db** (PostgreSQL 16 + pgvector), **rec** (Erkennung), **api**
(Fastify) und **proxy** (Caddy: TLS + ausgelieferte PWA + Weiterleitung an die
API). Nur der Proxy ist von außen erreichbar.

```bash
cp .env.production.example .env.production   # PCS_DOMAIN, TLS-Modus, Secrets setzen
docker compose --env-file .env.production up -d --build
PCS_URL=https://<domain> ./scripts/deploy-smoke.sh
```

TLS entweder über Let's Encrypt (`PCS_TLS_MODE=<eigene E-Mail>`, öffentliche
Domain) oder über Caddys eigene CA (`PCS_TLS_MODE=internal`, LAN). Die
Katalogdaten (DB + `./data`) werden vom Entwicklungsrechner übernommen oder auf
dem Server aufgebaut; die API wendet Migrationen beim Start selbst an. Die
vollständige Anleitung inkl. Backup, Fehlersuche und Sicherheit:
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Voraussetzungen

- Node.js 22+, `npx` (pnpm wird bei Bedarf über npx geladen – kein globales pnpm nötig)
- Python 3.11 (für den Erkennungs-Service, siehe `apps/rec/requirements.txt`)
- Optional: Docker mit Compose-Plugin (für das Deployment, siehe `DEPLOYMENT.md`)

Für die lokale Entwicklung ist **kein Docker nötig**: PostgreSQL läuft eingebettet
über `pgserver` auf `127.0.0.1:5433`.

## Einrichtung

```bash
# 1) Node-Abhängigkeiten
npx --yes pnpm@9.15.0 install

# 2) Python-Umgebung des Erkennungs-Service
python3.11 -m venv apps/rec/.venv
apps/rec/.venv/bin/pip install -r apps/rec/requirements.txt
apps/rec/.venv/bin/pip install paddlepaddle==3.1.1 setuptools

# 3) Konfiguration
cp .env.example .env      # Werte prüfen (DATABASE_URL, REF_CACHE_DIR, UPLOADS_DIR)

# 4) Datenbank starten und Katalog laden (einmalig, dauert ~1–2 h inkl. Bilder)
npm run dev:db            # Terminal 1 (eingebettetes PostgreSQL)
npm run sync:tcgdex       # Sets + Karten + Referenzbilder
npm run sync:names-en     # englische Kartennamen (für OCR-Vergleich)

# 5) Suchindizes aufbauen (einmalig, ~1 h)
npm run build:phash
npm run build:embeddings
```

## Lokaler Start

Vier Terminals (DB läuft aus der Einrichtung weiter):

```bash
npm run dev:db     # PostgreSQL (nur einmal starten)
npm run dev:rec    # Erkennungs-Service  http://127.0.0.1:8000
npm run dev:api    # API                 http://127.0.0.1:3000
npm run dev:web    # Web-App             http://127.0.0.1:5173
```

Dann im Browser `http://localhost:5173` öffnen.

> **Kamera am Handy:** `getUserMedia` läuft nur in einem _sicheren Kontext_.
> Auf `localhost` funktioniert die Kamera direkt. Für echte Handy-Tests im LAN
> gibt es zwei Wege: die App über das Deployment mit HTTPS aufrufen
> (`DEPLOYMENT.md`) oder – ohne HTTPS – den Galerie-Upload nutzen, der in der App
> als vollwertiger Fallback bereitsteht.

## Tests

```bash
npm run test:rec    # Erkennungs-Service: 22 Unit-Tests (Fusion, OCR, pHash, API)
npm run test:api    # API: 27 Tests (Uploads, Scans, Feedback, Auth, Sammlung, Rate-Limit)
npm run test:web    # PWA: 13 Playwright-Tests (mobil, Pixel 7)
                    #   Scan + Suche + Verlauf, Registrieren/Anmelden, Sammlung, Kartendetail,
                    #   Offline-Start (Service-Worker-Cache), Installations-Hinweis
npm run lint        # ESLint (TypeScript, React-Hooks, Node/Browser-Globals)
npm run lighthouse  # Lighthouse gegen den gebauten Stand (Build + Vorschau + Report)
npm run typecheck   # TypeScript in api + web
```

`npm run lint` bricht nur bei Fehlern ab. Die Hook-Regeln, die der
React-Compiler erzwingen würde, erscheinen als Hinweise (die App läuft ohne
Compiler) – darunter das übliche „Daten beim Aufbau laden“. Erklärungen stehen
in `eslint.config.js`.

Die Playwright-Tests brauchen laufende Dienste (DB, rec, API) und laden die
Kamera-Attrappe von Chromium; die Erkennung selbst läuft echt über den Service.
Die PWA-Tests laufen zusätzlich gegen den Build (`vite preview`, Port 4173), weil
Service Worker und Offline-Cache nur dort existieren.

Für das Deployment gibt es zwei Stufen (siehe `DEPLOYMENT.md`): `scripts/deploy-smoke.sh`
prüft die laufende Installation über HTTPS (Routing, Header, Cookies, Suche,
Bilder, Registrierung), und `apps/web/tests/deployment.spec.ts` geht den kompletten
Weg im Browser – inklusive der Prüfung, dass **alle** API-Aufrufe auf derselben
Herkunft bleiben:

```bash
PCS_INSECURE=1 PCS_URL=https://localhost:8443 ./scripts/deploy-smoke.sh
cd apps/web && PCS_DEPLOY_URL=https://<domain> npx playwright test tests/deployment.spec.ts
```

Ohne gesetzte `PCS_DEPLOY_URL` wird der Deployment-Browser-Test übersprungen.

## Erkennungsergebnisse

Gemessen mit `npm run evaluate` – 300 deterministisch simulierte Fotos
(Rotation, Skalierung, Hintergrund, Helligkeit), seed=42:

| Metrik          | Ergebnis              | Ziel           |
| --------------- | --------------------- | -------------- |
| Kartendetektion | 273/300 (91,0 %)      | –              |
| Top-1           | 262/300 (87,3 %)      | –              |
| Top-3           | 272/300 (90,7 %)      | –              |
| Auto-Rate       | 123/300 (41,0 %)      | –              |
| **Falsch-Auto** | **0/123 (0,00 %)**    | **< 0,5 %** ✅ |
| Latenz (CPU)    | p50 1,4 s · p95 2,1 s | –              |

Ohne Embeddings (nur pHash + OCR) liegt Top-1 bei ~69 % – die Bildähnlichkeit ist
der Haupttreiber. Details, Kalibrierung und Schwächen: [`apps/rec/README.md`](apps/rec/README.md).

## Grundsatz „nie stillschweigend falsch“

1. `autoSave=true` nur bei `final ≥ 0,85`, Vorsprung ≥ 0,08 **und** Bestätigung durch
   mindestens zwei unabhängige Verfahren.
2. **OCR-Veto:** widerspricht die gelesene Nummer (oder der Name) deutlich, wird nicht
   automatisch gespeichert – selbst bei sehr starker Bildähnlichkeit.
3. Ohne Auto-Speicherung sieht die Nutzerin Scan-Foto **und** Referenzbild nebeneinander
   sowie die Top-3 zur Auswahl; zusätzlich gibt es die manuelle Suche.
4. Jede Bestätigung/Korrektur wird gespeichert (`scans.status` = `confirmed`/`corrected`)
   und dient später der Schwellenkalibrierung an echten Daten.
5. Dieselbe Vorsicht gilt in der Sammlung: eine Korrektur nimmt die falsch erkannte
   Karte wieder heraus, Verwerfen entfernt sie, mehrfaches Bestätigen zählt nicht
   doppelt. Mengen ändern sich nur durch ausdrückliche Nutzer-Eingabe.

## Datenschutz (DSGVO)

- Hochgeladene Fotos werden serverseitig **neu kodiert**, dadurch werden EXIF-Daten
  inkl. GPS und Zeitstempel entfernt (`sharp` ohne `withMetadata`).
- Scans inkl. Foto lassen sich jederzeit einzeln löschen (`DELETE /scans/:id`, im
  Verlauf hinterlegt) – es werden keine Kopien aufbewahrt.
- **Anonyme Scans** gehören nur dem Browser (Zufalls-Cookie), nicht einer Person;
  beim Anmelden können sie dem eigenen Konto zugeschlagen werden.
- **Kontodaten:** E-Mail, optionaler Anzeigename und Argon2id-Passwort-Hash; die
  Sitzung liegt als Hash in der DB und läuft nach 30 Tagen ab. Passwortwechsel
  beendet alle anderen Sitzungen.
- Keine Weitergabe an Dritte; der Katalog stammt von TCGdex, Referenzbilder werden
  lokal zwischengespeichert.
- Upload-Limits (15 MB, nur JPEG/PNG/WebP per Magic-Bytes) und Rate-Limits
  (global 300/min, Scans 20/min, Login/Registrierung 10/min pro IP) schützen den Dienst;
  schreibende Anfragen prüfen zusätzlich die Herkunft (CSRF).

### Was den Rechner verlässt

- **Kartenfotos bleiben lokal.** OCR, Embeddings und Bildvergleich laufen im eigenen
  Erkennungs-Service; ein Foto geht höchstens an den eigenen Server (API → `apps/rec`).
  Es gibt **keine** Cloud-Dienste, kein Analytics, keine Telemetrie, keine CDN- oder
  Font-Aufrufe im Frontend – die PWA lädt ausschließlich eigene Dateien.
- Nach außen geht nur das Einrichten des Katalogs: `api.tcgdex.net` (Kartenstammdaten)
  und `images.pokemontcg.io` (Referenzbilder) – beides öffentliche Daten, ohne
  API-Schlüssel und ohne jeden Bezug zu Nutzern oder Fotos. Danach ist der Betrieb
  offline-fähig, was den Katalog angeht.
- **Keine API-Schlüssel im Projekt.** Es gibt keine Zugangsdaten für Dritte; die
  einzigen Geheimnisse sind `COOKIE_SECRET` und `POSTGRES_PASSWORD` aus der eigenen
  `.env`/`.env.production` (Rechte `600`, per `.gitignore` und `.dockerignore`
  ausgeschlossen).
- **Logs** enthalten nur Methode, Pfad, Status und Dauer (`pino`), keine Passwörter,
  Tokens oder Cookie-Werte; hochgeladene Fotos werden nicht protokolliert.
- Fremde Scans und Fotos sind auch direkt nicht abrufbar: `/scans/:id` und
  `/scans/:id/image` prüfen die Eigentümerschaft und antworten sonst mit `404`.

## Sicherheit

Der Code wurde gegen bekannte Schwachstellen geprüft (Abhängigkeiten,
Eingabevalidierung, Authentifizierung/Autorisierung, Kodierung, Betrieb und
Datenschutz). Der vollständige Bericht mit allen Befunden, Fundstellen,
Behebungen und den bewusst akzeptierten Restrisiken steht in
[`SECURITY.md`](SECURITY.md).

Die wichtigsten Punkte:

- **Härtung der Abhängigkeiten.** `drizzle-orm` 0.38.4 → 0.45.4 (CVE-2026-39356,
  SQL-Injection über Bezeichner) und `sharp` 0.33.5 → 0.35.5 (CVE-2026-96889 in
  librsvg/libvips/libheif) – beide verarbeiten Daten aus dem Netz.
  Python-Seite: `fastapi`, `starlette`, `python-multipart`, `pillow`,
  `python-dotenv` aktualisiert.
- **Kein interner Fehlertext nach außen.** 5xx-Antworten bleiben generisch,
  Details stehen nur im Log.
- **Rate-Limits greifen auch hinter dem Reverse-Proxy** (`trustProxy`), sonst
  zählte die ganze Instanz als eine Adresse.
- **Kein Pickle mehr.** Die Suchindizes enthalten nur noch Zahlen (`*.npz`);
  Kartennummern liegen daneben (`*.ids.json`). Ein manipulierter Index kann
  keinen Code mehr ausführen.
- **Content-Security-Policy** ohne `unsafe-eval`, `Permissions-Policy` (nur
  Kamera), `Cross-Origin-Opener-/Resource-Policy`, HSTS – gesetzt im Caddy.
- **Cookies mit `__Host-`-Präfix** im Betrieb (nur sichere Herkunft, `Secure`,
  `HttpOnly`, `SameSite=Lax`), Antworten von `/auth/*` mit `Cache-Control: no-store`.
- **Uploads geprüft:** Magic Bytes, 15 MB, zusätzlich begrenzte Pixelzahl
  (40 Mio.), EXIF wird beim Neukodieren verworfen.
- **Container getrennt:** Die API sieht den Index des Erkennungsdienstes nicht,
  nur den Referenzbild-Cache (lesend) und ihr eigenes Upload-Verzeichnis.

Offen und bewusst so belassen (mit Begründung in `SECURITY.md`): Registrierungs-
Enumeration, `imgaug` ohne verfügbaren Fix, Build-only-Advisories der
devDependencies, root-Container für den Erkennungsdienst, keine
E-Mail-Bestätigung/kein Passwort-Reset/kein 2FA.

## Projektstruktur

```text
apps/api       Fastify-API (Katalog, Scans, Auth, Sammlung) + Sync-Skripte
apps/rec       FastAPI-Erkennung (pHash, DINOv2, OCR, Konsens) + Evaluation
apps/web       React-PWA (Kamera-Scan, Ergebnisprüfung, Verlauf, Sammlung, Login)
apps/web/ios   Xcode-Projekt der nativen Hülle (Capacitor, SPM) → IOS.md
packages/shared  gemeinsame Typen
deploy/        Caddyfile + Edge-Image (PWA + TLS)   → DEPLOYMENT.md
.github/workflows/ios.yml  Build der unsignierten .ipa auf macOS
docker-compose.yml  Produktions-Stack (db, rec, api, proxy)
scripts/dev-db.py  eingebettetes PostgreSQL (Entwicklung)
scripts/deploy-smoke.sh  Rauchtest der laufenden Installation
eslint.config.js  ESLint-Konfiguration (flat config) fuer alle Pakete
SECURITY.md   Sicherheitsbericht (Prüfung, Befunde, Restrisiken)
data/          Referenzbilder, Indizes, Uploads (per .gitignore ausgeschlossen)
.env           lokale Geheimnisse (Rechte 600, nie versionieren)
```
