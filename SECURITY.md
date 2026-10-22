# Sicherheitsbericht

Prüfung des KI-generierten Codes (PWA + Fastify-API + FastAPI-Erkennungsdienst)
auf bekannte Schwachstellen. Stand: 2026-10-22, zweite Runde.

Kurzfassung: In Runde 2 wurden **17 Befunde** erhoben, davon **3 hoch**, **6 mittel**,
**6 niedrig** und **2 informativ**. Alle wurden behoben und durch Tests belegt;
was bewusst offen bleibt, steht mit Begründung in Abschnitt 4.

---

## 1. Prüfrahmen

| Bereich            | Geprüft                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| Abhängigkeiten     | `pnpm audit` (JS), `pip-audit` (Python)                                       |
| Eingabevalidierung | alle Routen der API, Upload-Pfad, Suchparameter                               |
| Authentifizierung  | Sitzungen, Cookies, CSRF, Passwörter, Rate-Limits                             |
| Autorisierung      | Besitzprüfung bei Scans/Fotos/Sammlung (IDOR)                                 |
| Kodierung          | XSS, SQL-Injection, Path Traversal, SSRF, Deserialisierung, Command Injection |
| Betrieb            | Reverse-Proxy-Konfiguration, Header, Container, Dateirechte, Secrets          |
| Datenschutz        | Metadaten in Fotos, Fremdzugriff auf Uploads, Löschung                        |

Werkzeuge: `pnpm audit`, `uvx pip-audit`, `ripgrep`-Musterprüfungen, `eslint`,
manuelle Codeprüfung aller sicherheitsrelevanten Pfade, Testläufe (27 API-,
22 rec-, 15 Webtests, 30 Deployment-Checks).

Die Prüfung ist eine statische/reproduzierbare Analyse, kein Penetrationstest.
Ein externer Penetrationstest und ein Audit der Container-Härtung stehen noch aus.

---

## 2. Befunde Runde 2 (behoben)

### 2.1 HOCH – SQL-Injection-Lücke in `drizzle-orm`

- **Fundstelle:** `apps/api/package.json` (`drizzle-orm@0.38.4`)
- **Problem:** CVE-2026-39356 (GHSA-gpj5-g38j-94v9) – nicht escapte
  SQL-Bezeichner ermöglichen Injection, wenn Benutzerdaten als Bezeichner
  (nicht als Parameter) eingesetzt werden.
- **Bewertung im Projekt:** Die API verwendet ausschließlich **statische**
  Bezeichner; Benutzereingaben gehen immer als gebundene Parameter ein
  (`sql\`... = ${wert}\``). Ein direkter Angriffspfad war damit nicht vorhanden –
  die Lücke war trotzdem in einer produktiv genutzten Abhängigkeit.
- **Behebung:** Upgrade auf `drizzle-orm@0.45.4` (>= 0.45.2), `drizzle-kit@0.31.11`.
- **Nachweis:** `pnpm audit` meldet für die Laufzeit-Abhängigkeiten nichts mehr;
  Typprüfung und alle 27 API-Tests grün.

### 2.2 HOCH – `sharp` mit verwundbarer libvips/libheif/librsvg

- **Fundstelle:** `apps/api/package.json` (`sharp@0.33.5`)
- **Problem:** CVE-2026-96889 (librsvg) sowie CVEs in libvips und libheif
  (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c). `sharp` verarbeitet hier direkt
  vom Nutzer hochgeladene Bilder.
- **Behebung:** Upgrade auf `sharp@0.35.5`.
- **Nachweis:** Audit sauber; Upload-Verarbeitung und Erkennung unverändert
  (Referenzkarte: `final=0.9634`).

### 2.3 HOCH – Rate-Limit hinter dem Reverse-Proxy nicht wirksam

- **Fundstelle:** `apps/api/src/app.ts` (Fastify-Option `trustProxy` fehlte)
- **Problem:** Ohne `trustProxy` sieht die API nur die IP des Caddy-Containers.
  Das Rate-Limit zählte damit **alle** Nutzer zusammen (300/min global,
  20/min für Scans, 10/min für Logins). Ein einzelner Angreifer konnte die
  ganze Instanz für alle aussperren; die echte Client-IP fehlte auch im Log.
- **Behebung:** `trustProxy` auf die privaten Adressbereiche gesetzt
  (`uniquelocal,loopback,linklocal`, überschreibbar per `TRUST_PROXY`).
  Kommt die Anfrage direkt aus dem Internet, wird der Header
  `X-Forwarded-For` ignoriert – die API darf im Betrieb **nicht** direkt
  erreichbar sein (im Compose ist kein Port veröffentlicht).
- **Nachweis:** Neuer Test „Rate-Limit zählt pro Client-IP, auch hinter dem
  Reverse-Proxy" (`apps/api/test/routes.test.ts`).

### 2.4 MITTEL – Interne Fehlermeldungen an den Client

- **Fundstelle:** `apps/api/src/app.ts` (Error-Handler), `apps/api/src/routes/scans.ts`
- **Problem:** Der Fehler-Handler gab `err.message` ungefiltert weiter. Damit
  konnten Datenbankfehler (Tabellen-/Spaltennamen), Dateipfade oder die
  Antwort des Erkennungsdienstes nach außen gelangen.
- **Behebung:** 5xx antworten jetzt mit einem generischen Text
  („Interner Fehler"), Details stehen nur im Log. 4xx behält die kurze,
  selbst formulierte Meldung. Der Erkennungsdienst-Fehler wird nur protokolliert.
- **Nachweis:** Test prüft, dass weder `ECONNREFUSED` noch Host/Port nach außen
  gelangen.

### 2.5 MITTEL – Fehlende Content-Security-Policy und weitere Header

- **Fundstelle:** `deploy/Caddyfile`
- **Problem:** Es gab HSTS, `X-Content-Type-Options`, `X-Frame-Options` und
  `Referrer-Policy`, aber **keine CSP**. Damit war die PWA bei einem XSS oder
  einer manipulierten Karte nicht abgesichert.
- **Behebung:** CSP (`default-src 'self'`, kein `unsafe-eval`, keine externen
  Quellen), `Permissions-Policy` (nur Kamera), `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`.
- **Nachweis:** Deployment-Rauchtest prüft die Header; die PWA läuft mit
  aktiver CSP (Deployment-Tests + 30/30 Rauchchecks).

### 2.6 MITTEL – Pickle-Deserialisierung im Erkennungsdienst

- **Fundstelle:** `apps/rec/app/phash.py`, `apps/rec/app/embeddings.py`
  (`np.load(..., allow_pickle=True)`)
- **Problem:** Die Indizes enthielten Kartennummern als Objekt-Array; numpy
  lädt Objekt-Arrays nur mit `allow_pickle=True`. Wer den Index-Ordner
  manipulieren konnte, hätte im Erkennungsdienst beliebigen Code ausführen
  können (CWE-502). Der Index lag im gemeinsam gemounteten Datenverzeichnis.
- **Behebung:** Index-Format getrennt: `*.npz` enthält nur noch Zahlen,
  die Kartennummern liegen als `*.ids.json` daneben. Der Betrieb lädt mit
  `allow_pickle=False`. Das bestehende Format wurde konvertiert
  (`apps/rec/scripts/migrate_index_format.py`, 17.085 Einträge) – ein Neubau
  der Indizes war nicht nötig.
- **Nachweis:** `phash`-Index lädt 17.085 Einträge, Erkennung unverändert;
  22 rec-Tests grün.

### 2.7 MITTEL – Fehlende Pfadprüfung beim Löschen eines Scan-Fotos

- **Fundstelle:** `apps/api/src/lib/images.ts` (`deleteScanImage`)
- **Problem:** Beim Löschen wurde der Pfad ungeprüft zusammengesetzt, anders
  als beim Ausliefern (`scanImagePath`). Ein manipulierter Datenbankeintrag
  hätte eine Datei außerhalb des Upload-Ordners löschen können.
- **Behebung:** Löschen nutzt jetzt dieselbe geprüfte Pfadfunktion.

### 2.8 MITTEL – Keine Begrenzung der Pixelzahl (Bild-Bombe)

- **Fundstelle:** `apps/api/src/lib/images.ts` (`sharp` ohne `limitInputPixels`)
- **Problem:** Die Dateigröße war auf 15 MB begrenzt, die Pixelzahl nicht.
  Ein stark komprimiertes Bild konnte den Speicher des Prozesses füllen.
- **Behebung:** `limitInputPixels: 40_000_000` (statt der sharp-Voreinstellung
  von rund 268 Mio.).

### 2.9 MITTEL – Veraltete Python-Abhängigkeiten mit aktuellen Lücken

- **Fundstelle:** `apps/rec/requirements.txt`
- **Problem:** 85 gemeldete Lücken in fünf Paketen, davon direkt im
  Upload-Pfad des internen Dienstes: `python-multipart` 0.0.20 (12 Lücken,
  u. a. DoS bei Multipart-Formaten), `starlette` 0.41.3 (14), `pillow` 11.0.0
  (55), `python-dotenv` 1.0.1 (2), `fastapi` 0.115.6.
- **Behebung:** `fastapi==0.159.1`, `starlette==1.9.0`,
  `python-multipart==0.0.32`, `pillow==13.0.0`, `python-dotenv==1.2.4`.
- **Nachweis:** `pip-audit` meldet nur noch `imgaug` (siehe Abschnitt 4);
  OCR und Erkennung liefern identische Ergebnisse; 22 rec-Tests grün.

### 2.10 NIEDRIG – Cookies ohne `__Host-`-Präfix

- **Fundstelle:** `apps/api/src/auth/session.ts`, `apps/api/src/auth/plugin.ts`
- **Problem:** Ein Cookie ohne `__Host-`-Präfix kann eine fremde Subdomain
  „injected“ setzen (Session-Fixation über Subdomain).
- **Behebung:** Im Betrieb tragen Sitzungs- und Anonym-Cookie das
  `__Host-`-Präfix (Voraussetzung: `Secure`, `Path=/`, kein `Domain`-Attribut).
  Im Entwicklungsmodus (HTTP) bleibt der alte Name, damit der Browser das
  Cookie annimmt.
- **Nachweis:** Deployment-Rauchtest prüft Name, `Secure`, `HttpOnly`,
  `SameSite=Lax` und `Path=/`; Deployment-Playwright-Test bestätigt, dass die
  Anmeldung über HTTPS funktioniert.

### 2.11 NIEDRIG – Kontodaten im Cache

- **Fundstelle:** `apps/api/src/auth/plugin.ts`
- **Problem:** Antworten von `/auth/*` trugen kein `Cache-Control: no-store`.
- **Behebung:** Hook setzt `no-store` für alle `/auth`-Antworten.

### 2.12 NIEDRIG – `/health` legte Interna offen

- **Fundstelle:** `apps/api/src/app.ts`
- **Problem:** `/health` gab die Zähler des Erkennungsdienstes (Indexgröße,
  Kartenzahl) aus. Der Endpunkt ist öffentlich erreichbar.
- **Behebung:** Antwort enthält nur noch `status`, `ts` und
  `recognition: ok|unavailable`.

### 2.13 NIEDRIG – Upload-Verarbeitung im Erkennungsdienst

- **Fundstelle:** `apps/rec/app/main.py`
- **Problem:** `await image.read()` las die Datei ohne Limit in den Speicher
  (die Größenprüfung kam danach), die Bild-Prüfung stützte sich nur auf den
  vom Aufrufer gesetzten Content-Type, und `/docs`/`/openapi.json` waren offen.
- **Behebung:** Lesen mit Limit (15 MB + 1), Prüfung der Magic Bytes
  (JPEG/PNG/WebP), API-Beschreibung abgeschaltet. Der Dienst ist ohnehin nur
  im internen Docker-Netz erreichbar.

### 2.14 NIEDRIG – Unbegrenzte Suchbegriffe

- **Fundstelle:** `apps/api/src/routes/cards.ts`, `apps/api/src/routes/collection.ts`
- **Problem:** Sehr lange Suchbegriffe machten die `ILIKE`-Suche teuer.
- **Behebung:** Obergrenze von 100 Zeichen.

### 2.15 NIEDRIG – Erkennungsdienst blieb nach Startfehler defekt

- **Fundstelle:** `apps/rec/app/pipeline.py`
- **Problem:** Schlug die Initialisierung fehl (z. B. Datenbank noch nicht
  bereit), blieb ein halb initialisiertes Objekt im Singleton zurück – der
  Dienst war bis zum Neustart kaputt (Verfügbarkeitsrisiko).
- **Behebung:** Bei Fehlern wird der Singleton nicht zwischengespeichert; der
  nächste Aufruf startet neu.

### 2.16 INFO – API hatte Schreibzugriff auf den Index

- **Fundstelle:** `docker-compose.yml`
- **Problem:** Die API mountete das gesamte Datenverzeichnis und konnte damit
  den Index des Erkennungsdienstes verändern.
- **Behebung:** Die Mounts sind getrennt: `api` sieht nur
  `ref_cache` (lesend) und `uploads` (schreibend), `rec` nur `index` und
  `ref_cache` (lesend). Die API hat keinen Zugriff mehr auf den Index.

### 2.17 INFO – Testaufbau überschrieb den Produktions-Build

- **Fundstelle:** `apps/web/playwright.config.ts`
- **Problem:** Der im Playwright-Setup gestartete Build erzeugte die App immer
  ohne `VITE_API_URL=same-origin` und überschrieb damit eine bereits gebaute
  Produktionsversion – der Deployment-Test konnte so nie grün werden.
- **Behebung:** Bei gesetztem `PCS_DEPLOY_URL` wird nicht neu gebaut.

---

## 3. Befunde Runde 1 (weiterhin behoben)

- keine API-Schlüssel, keine externen Skripte/CDNs/Telemetrie
- EXIF/GPS werden beim Upload entfernt (Neukodierung ohne Metadaten)
- Fremde Scans und Fotos liefern 404 (`ownerFilter`), keine fremden Daten
- keine Zugangsdaten in Logs
- `.dockerignore` schließt `.env` und Daten aus; Datenverzeichnis 700
- API gibt nach außen ausschließlich TCGdex-IDs preis

---

## 4. Angenommene Risiken (bewusst nicht behoben)

| Risiko                                                                                         | Begründung                                                                                                                                                                                                              | Maßnahme                                                                                           |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Registrierungs-Enumeration** (`POST /auth/register` meldet „existiert bereits“)              | Üblich (GitHub, GitLab); der Login-Pfad verrät nichts (Dummy-Verifikation).                                                                                                                                             | Bewusst so belassen, in der Oberfläche erklärt.                                                    |
| **`imgaug` 0.4.0 (PYSEC-2026-356)**                                                            | Paket ist ungepflegt, kein Fix verfügbar. Die Lücke steckt in `BackgroundAugmenter` (Multicore) und wird nur beim Training verwendet. `imgaug` wird von PaddleOCR beim Import geladen, `imgaug.multicore` jedoch nicht. | Nicht erreichbar, da nie mit fremden Daten gearbeitet wird. Beobachtung bei PaddleOCR-Updates.     |
| **Build-only-Advisories** (1× hoch: `braces`; 2× mittel: `esbuild`, `postcss-selector-parser`) | Hängen an `drizzle-kit` und `tailwindcss` (devDependencies). Sie wirken nur beim Bauen, nicht im Betrieb (`pnpm audit --prod`: keine).                                                                                  | Kein Fix ohne Bruch der Tailwind-/Drizzle-Kompatibilität; Build läuft nur auf dem eigenen Rechner. |
| **Erkennungsdienst läuft als root im Container**                                               | Der Dienst bindet keinen privilegierten Port. Ein Umbau auf `nonroot` ändert die Rechte an `./data/index` und ist ohne Docker-Test nicht verifizierbar.                                                                 | Empfehlung für den Produktivbetrieb (siehe DEPLOYMENT.md).                                         |
| **Keine E-Mail-Bestätigung, kein Passwort-Reset, kein 2FA**                                    | Privatbetrieb ohne Mailserver; Konten werden lokal verwaltet.                                                                                                                                                           | Empfehlung, sobald der Betrieb mehr als eine Person umfasst.                                       |
| **Sitzungsdauer 30 Tage**                                                                      | Bequem für den Privatbetrieb.                                                                                                                                                                                           | Bei Bedarf `SESSION_TTL_MS` verkürzen.                                                             |

---

## 5. Abhängigkeiten – aktueller Stand

```
pnpm audit        → 3 Advisories, alle nur in devDependencies (Build)
                    `pnpm audit --prod` meldet keine
pip-audit         → 1 Paket (imgaug), nicht erreichbar, kein Fix
```

Nicht automatisch behebbar, aber beobachtet: `axios`, `postgres`, `fastify`
sind aktuell; ein Update-Skript (`pnpm outdated`) gehört in die Routine.

---

## 6. Hinweise für den Betrieb

1. **Die API darf nicht direkt aus dem Internet erreichbar sein.** Nur so ist
   `X-Forwarded-For` vertrauenswürdig. Im Compose ist kein Port veröffentlicht –
   das muss bei eigenen Firewalls/Reverse-Proxies erhalten bleiben.
2. **`TRUST_PROXY`** steuert das Vertrauen in Proxy-Header
   (Standard: private Adressbereiche). `TRUST_PROXY=0` nur, wenn die API
   ohne Proxy läuft.
3. **`COOKIE_SECRET`** vor dem Produktivbetrieb zufällig erzeugen und
   bei Bedarf rotieren.
4. **Index-Format:** `data/index/*.npz` (nur Zahlen) + `data/index/*.ids.json`.
   Alte Dateien lassen sich mit
   `python -m scripts.migrate_index_format` wandeln, ohne Neubau.
5. **Nach jedem Update:** `pnpm audit`, `uvx pip-audit -r apps/rec/requirements.txt`,
   `npm run lint && npm run typecheck && npm run test:api && npm run test:rec && npm run test:web`
   und `PCS_URL=… ./scripts/deploy-smoke.sh` ausführen.

---

## 7. Prüfung wiederholen

```bash
# Abhängigkeiten
npx --yes pnpm@9.15.0 audit --audit-level low
uvx pip-audit -r apps/rec/requirements.txt

# Tests
npm run typecheck
npm run lint          # ESLint (0 Fehler; Hinweise erklaert in eslint.config.js)
npm run test:api      # 27 Tests (benötigt die Datenbank)
npm run test:rec      # 22 Tests
npm run test:web      # 15 Tests (2 ohne Deployment-URL übersprungen)

# Deployment-Pfad
VITE_API_URL=same-origin npx --yes vite build   # in apps/web
PCS_INSECURE=1 PCS_URL=https://localhost:8443 ./scripts/deploy-smoke.sh
```
