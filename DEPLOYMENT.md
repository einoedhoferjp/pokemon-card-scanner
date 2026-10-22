# Deployment (Docker Compose mit HTTPS)

Der Karten-Scanner läuft produktiv als Compose-Stack aus vier Containern. Web und
API liegen dabei auf **einer** Herkunft (`https://<PCS_DOMAIN>`), Caddy übernimmt
TLS und die Aufteilung zwischen PWA und API. Dadurch braucht die App kein CORS,
die Cookies sind erst-parteiisch und `Secure` funktioniert.

## Was läuft wo

| Dienst  | Inhalt                                           | Ports (extern) | Daten                              |
| ------- | ------------------------------------------------ | -------------- | ---------------------------------- |
| `proxy` | Caddy: TLS + gebaute PWA + Reverse-Proxy zur API | 80, 443        | `caddy_data` (Zertifikate)         |
| `api`   | Fastify: Scans, Katalog, Konten, Sammlung        | –              | `./data` (Uploads, Referenzbilder) |
| `rec`   | FastAPI: OCR + Embedding/pHash-Vergleich         | –              | `./data/index`, `./data/ref_cache` |
| `db`    | PostgreSQL 16 + pgvector                         | –              | `pgdata` (Volume)                  |

Nur `proxy` ist von außen erreichbar. Datenbank, API und Erkennung liegen im
internen Compose-Netz `backend`.

Datenvolumen: `./data/ref_cache/cards` ca. 3,2 GB (17.085 Referenzbilder),
`./data/index` ca. 24 MB, `data/uploads` wächst mit jedem Scan.
Arbeitsspeicher: `rec` braucht ~1–2 GB (PaddleOCR + ONNX), `db` ~200 MB,
`api` ~150 MB. Ein Host mit 4 GB RAM reicht.

Image-Größen (grob): `proxy` ~120 MB, `api` ~350 MB (Node + pnpm-Store),
`rec` ~2,5 GB (PaddleOCR/PaddlePaddle + Modell). Die Limit-Angaben in
`docker-compose.yml` sind nur Obergrenzen für den Notfall.

`docker-compose.dev.yml` und die `Dockerfile.dev` sind eine **optionale**
Alternative für die lokale Entwicklung mit Containern; der normale Weg ist
`npm run dev:*` ohne Docker (siehe `README.md`). Das Deployment hier nutzt
`docker-compose.yml`.

## Voraussetzungen

- Docker Engine mit Compose-Plugin (`docker compose version`)
- Für Let's Encrypt: eine Domain, deren A/AAAA-Record auf den Server zeigt, und
  die Ports 80 + 443 von außen erreichbar
- Ohne Domain (LAN): eigene CA, siehe Abschnitt „Eigene CA"

## 1. Vorbereiten

```bash
cp .env.production.example .env.production
# PCS_DOMAIN eintragen, PCS_TLS_MODE wählen, Secrets setzen:
openssl rand -base64 24   # -> POSTGRES_PASSWORD
openssl rand -base64 32   # -> COOKIE_SECRET
# PUID/PGID auf den Nutzer setzen, dem ./data gehört:
id -u && id -g
```

Alle Schritte danach immer mit derselben Datei:

```bash
docker compose --env-file .env.production <befehl>
```

## 2. Katalogdaten bereitstellen

Die Installation braucht zwei Dinge, die **nicht** im Image stecken: die
Kartendaten in der Datenbank und `./data` (Referenzbilder + Index). Der einfache
Weg ist, beides vom Entwicklungsrechner zu kopieren.

### Empfohlen: aus der Entwicklung übernehmen

Auf dem Entwicklungsrechner:

```bash
pg_dump -h 127.0.0.1 -p 5433 -U postgres -d pcs_db \
  --no-owner --no-privileges -Fc -f pcs_db.dump
rsync -a --info=progress2 data/ server:/pfad/zum/scanner/data/
scp pcs_db.dump server:/pfad/zum/scanner/
```

Auf dem Server:

```bash
docker compose --env-file .env.production up -d db
docker compose --env-file .env.production exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" -O -x --clean --if-exists' < pcs_db.dump
```

(`-O -x` lässt Besitzer- und Rechteangaben weg, weil im Container andere Rollen
gelten.)

### Alternativ: auf dem Server neu aufbauen

```bash
# Schema anlegen
docker compose --env-file .env.production run --rm --no-deps api node dist/scripts/migrate.js
# Katalog von TCGdex holen (20.232 Karten + Referenzbilder, ~30 min, ~3,5 GB)
docker compose --env-file .env.production run --rm --no-deps api node dist/scripts/sync-tcgdex.js
# englische Kartennamen nachtragen
docker compose --env-file .env.production run --rm --no-deps api node dist/scripts/sync-names-en.js
# Index für die Erkennung bauen (pHash ~3 min, Embeddings ~60 min)
docker compose --env-file .env.production run --rm --no-deps rec python -m scripts.build_phash
docker compose --env-file .env.production run --rm --no-deps rec python -m scripts.build_embeddings
```

Ohne `./data/index/*.npz` wird `rec` nie „healthy" und der Stack startet nicht
durch – das ist der häufigste Stolperstein.

### Format der Suchindizes

Die Indizes liegen als Paar-Dateien im Ordner `data/index`:

| Datei        | Inhalt                                                |
| ------------ | ----------------------------------------------------- |
| `*.npz`      | nur Zahlen (pHash-Hashes bzw. Embedding-Vektoren)     |
| `*.ids.json` | die zugehörigen Kartennummern in gleicher Reihenfolge |

Bewusst getrennt: `*.npz` wird ohne `allow_pickle` gelesen, eine manipulierte
Datei kann so keinen Code ausführen. Ältere Indizes (mit Kartennummern direkt im
`npz`) lassen sich ohne Neubau wandeln:

```bash
docker compose --env-file .env.production run --rm --no-deps rec \
  python -m scripts.migrate_index_format
```

## 3. Starten

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps       # alle "healthy"?
docker compose --env-file .env.production logs -f proxy api
```

Die API wendet beim Start fehlende Migrationen an (`MIGRATE_ON_START=1`), die PWA
wird beim Image-Bau erzeugt (`VITE_API_URL=same-origin`).

Danach `https://<PCS_DOMAIN>` öffnen.

## 4. HTTPS

**Let's Encrypt** (`PCS_TLS_MODE=dein@mail.de`): Caddy holt und erneuert die
Zertifikate automatisch; Voraussetzung sind die öffentliche Domain und die Ports
80/443. Keine weiteren Schritte, keine Browserwarnung.

**Eigene CA** (`PCS_TLS_MODE=internal`, Standard): Caddy erzeugt eine eigene
Zertifizierungsstelle. Die Verbindung ist verschlüsselt, der Browser warnt aber,
solange die CA nicht installiert ist.

```bash
# Root-Zertifikat der Installation holen und z. B. auf dem Handy installieren
docker compose --env-file .env.production cp proxy:/data/caddy/pki/authorities/local/root.crt ./pcs-root-ca.crt
```

Ohne installierte CA bleibt das Scannen per Kamera trotzdem möglich, weil die App
den Galerie-Upload als vollwertigen Ersatz anbietet (nur der direkte Kamera-Zugriff
braucht einen „sicheren Kontext").

### Auf dem iPhone testen

Es gibt zwei Wege:

- **PWA** (kein Build nötig, sofort aktuell): in **Safari** öffnen und über
  Teilen → **Zum Home-Bildschirm** installieren. Nur Safari kann PWAs
  installieren.
- **Native App** (`.ipa` aus GitHub Actions, Installation per AltStore): siehe
  [IOS.md](IOS.md). Die App ist eine Hülle um dieselbe PWA und lädt sie über die
  beim Build gesetzte HTTPS-Adresse.

1. `https://<PCS_DOMAIN>` in **Safari** öffnen (nur Safari kann PWAs installieren).
2. Teilen-Symbol → **Zum Home-Bildschirm** → _Hinzufügen_.

Voraussetzung für die Kamera ist ein **vertrauenswürdiges** Zertifikat. Mit der
eigenen CA (`PCS_TLS_MODE=internal`):

1. `pcs-root-ca.crt` aufs iPhone bringen (AirDrop, Dateien-App, E-Mail).
2. Einstellungen → Allgemein → VPN & Geräteverwaltung → Profil → _Installieren_.
3. Einstellungen → Allgemein → Info → **Zertifikatsvertrauen** → den Namen der
   Installation aktivieren (vollständiges Vertrauen).
4. Safari neu öffnen; es darf keine Warnung mehr erscheinen.

Ohne diesen Schritt funktioniert die Seite, aber `getUserMedia` ist gesperrt: die
Scan-Seite meldet dann „Kamera braucht HTTPS“ und bietet nur die Galerie an.

Für die CA-Variante muss `PCS_DOMAIN` ein Name oder eine IP aus dem LAN sein, den
das iPhone erreicht (`scanner.local` per mDNS/Avahi oder z. B. `192.168.1.50`);
`localhost` funktioniert nur auf dem Rechner selbst. Caddy stellt das Zertifikat
auf genau diesen Namen/diese IP aus. Wird das Caddy-Datenverzeichnis neu angelegt,
ist auch ein neues Root-Zertifikat fällig.

Auf dem Gerät lohnt sich ein Blick auf: Kamera-Scan bei Kunstlicht, Galerie-Foto
(iOS liefert HEIC, Safari wandelt es für `accept="image/jpeg,…"` nach JPEG),
Bestätigen/Korrigieren, Verlauf inkl. Löschen, Installationshinweis, Start im
Flugmodus und die Ränder (Notch, Home-Indikator).

## 5. Betrieb

```bash
# Logs
docker compose --env-file .env.production logs -f api
# Neustart nach Konfigurationsänderung
docker compose --env-file .env.production up -d
# Neue Version einspielen (Code aktualisieren, dann):
docker compose --env-file .env.production up -d --build
# Stoppen (Daten bleiben in den Volumes/Bind-Mounts)
docker compose --env-file .env.production down
```

## 6. Backup und Wiederherstellung

Zu sichern sind zwei Dinge: die Datenbank und `./data` (Uploads + Referenzbilder;
die Referenzbilder lassen sich notfalls neu erzeugen, die Uploads nicht).

```bash
# Datenbank
docker compose --env-file .env.production exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-$(date +%F).dump
# Uploads (nur die eigenen Fotos, ohne den nachbaubaren Referenz-Cache)
tar czf uploads-$(date +%F).tar.gz -C data uploads
```

Wiederherstellen:

```bash
docker compose --env-file .env.production exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" -O -x --clean --if-exists' < backup-2026-01-01.dump
```

## 7. Rauchtests

Nach jedem Deployment:

```bash
PCS_URL=https://scanner.example.org ./scripts/deploy-smoke.sh
# bei eigener CA:
PCS_INSECURE=1 PCS_URL=https://<host>:443 ./scripts/deploy-smoke.sh
```

Der Test prüft TLS/Sicherheits-Header (HSTS, `X-Content-Type-Options`,
Content-Security-Policy, Permissions-Policy), Routing (PWA vs. API), die
PWA-Dateien, Kartensuche und Referenzbilder sowie Registrierung, Cookies
(`__Host-`-Präfix, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`),
`Cache-Control: no-store` für Kontodaten, Sammlung und Abmelden. Er legt dafür
ein Testkonto `smoke-<zeit>@example.invalid` an und nennt am Ende den Befehl
zum Entfernen.

Zusätzlich gibt es einen Browser-Test, der den kompletten Weg über HTTPS geht
(Konto anlegen, Foto scannen, Referenz- und eigenes Bild laden) und prüft, dass
**alle** API-Aufrufe auf derselben Herkunft bleiben:

```bash
cd apps/web
PCS_DEPLOY_URL=https://scanner.example.org npx playwright test tests/deployment.spec.ts
```

Der Browser-Test braucht die bereits gebaute Produktionsversion – er baut
absichtlich **nicht** neu (ein Neubau ohne `VITE_API_URL=same-origin` würde die
API wieder auf Port 3000 legen). Vorher einmal:

```bash
cd apps/web && VITE_API_URL=same-origin npx vite build
```

## 8. Fehlersuche

| Symptom                                          | Ursache / Lösung                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `proxy` startet nicht, „bind: permission denied" | Ein anderer Dienst belegt Port 80/443 (`ss -ltnp \| grep :443`)                                         |
| `api` startet nicht, wartet auf `rec`            | `./data/index/*.npz` fehlt → Index bauen (Abschnitt 2)                                                  |
| 502 im Browser                                   | `api` nicht healthy: `docker compose logs api` (DB-Zugang, `COOKIE_SECRET` gesetzt?)                    |
| Anmeldung „klappt nicht", Cookie fehlt           | `PCS_DOMAIN` passt nicht zur aufgerufenen URL → `CORS_ORIGINS` (aus `PCS_DOMAIN` gebildet) greift nicht |
| Zertifikatswarnung trotz HTTPS                   | `PCS_TLS_MODE=internal` → CA installieren oder auf Let's Encrypt wechseln                               |
| Fotos werden nicht gespeichert                   | Rechte auf `./data/uploads` prüfen: `PUID`/`PGID` müssen dem Host-Nutzer entsprechen                    |

## 9. Sicherheit

Der Code wurde auf bekannte Schwachstellen geprüft. Der vollständige Bericht
mit allen Befunden, Fundstellen und den bewusst akzeptierten Restrisiken steht
in [`SECURITY.md`](SECURITY.md).

### Umgesetzt

- **Nur der Proxy ist exponiert.** Kein Port der API, der Datenbank oder des
  Erkennungsdienstes ist nach außen veröffentlicht. Das ist auch Voraussetzung
  dafür, dass `X-Forwarded-For` vertrauenswürdig ist.
- **TLS mit HSTS**, Content-Security-Policy (ohne `unsafe-eval`, keine externen
  Quellen), Permissions-Policy (nur Kamera), `Cross-Origin-Opener-/Resource-Policy`,
  `X-Frame-Options: DENY`, `Referrer-Policy`.
- **Sitzungs- und Anonym-Cookie** mit `__Host-`-Präfix, `Secure`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`; Antworten von `/auth/*` mit `Cache-Control: no-store`.
- **Origin-Prüfung** für schreibende Anfragen (CSRF) plus CORS auf eine
  Herkunft (`CORS_ORIGINS`, aus `PCS_DOMAIN` gebildet).
- **Rate-Limits** in der API (300/min global, 20/min Scans, 10/min Anmeldung)
  – und zwar **pro Client-IP auch hinter dem Proxy** (`trustProxy`).
- **Upload-Prüfung:** Magic Bytes (JPEG/PNG/WebP), 15 MB, begrenzte Pixelzahl
  (40 Mio.), EXIF wird beim Neukodieren verworfen.
- **Argon2id-Passwörter**, Sitzungstoken nur als Hash in der DB, Trennung der
  Daten pro Nutzer (fremde Scans/Sammlungen → 404).
- **Getrennte Container-Mounts:** Die API sieht nur `data/ref_cache` (lesend) und
  `data/uploads` (schreibend) – der Index des Erkennungsdienstes ist für sie
  gar nicht sichtbar. Der Erkennungsdienst sieht `data/index` und
  `data/ref_cache` (lesend).
- **Kein Pickle:** Die Indizes enthalten nur Zahlen (`*.npz`), die Kartennummern
  liegen daneben (`*.ids.json`).
- **Keine internen Fehlermeldungen** nach außen: 5xx antworten generisch,
  Details stehen nur im Log.

### `TRUST_PROXY`

Die API vertraut Proxy-Headern nur für private Adressbereiche
(`uniquelocal,loopback,linklocal`) – so zählt das Rate-Limit pro echter Client-IP.
Über die Umgebungsvariable `TRUST_PROXY` lässt sich das anpassen:

```bash
# Standard (empfohlen): nur private Adressbereiche
TRUST_PROXY=uniquelocal,loopback,linklocal
# API läuft ohne Proxy -> gar keinen Header vertrauen
TRUST_PROXY=0
```

**Wichtig:** Die API darf nicht direkt aus dem Internet erreichbar sein. Sonst
könnte ein Angreifer `X-Forwarded-For` fälschen und das Rate-Limit umgehen.

### Bewusst nicht enthalten (für ein privates Projekt)

Zwei-Faktor-Anmeldung, Passwort-Reset per E-Mail, automatische Backups,
Monitoring/Alerting, Multi-Tenant-Härtung, Registrierungs-Enumeration ist
möglich (die Meldung „E-Mail ist bereits vergeben"). `docker compose` verwaltet
die Geheimnisse über `.env.production` – diese Datei nicht weitergeben.

### Vor dem Produktivbetrieb

- `COOKIE_SECRET` zufällig erzeugen (nicht der Beispielwert) und bei Verdacht rotieren.
- `./data` auf den Host-Nutzer beschränken (`PUID`/`PGID` in `.env.production`).
- Optional: den Erkennungsdienst ohne `root` laufen lassen (`user:` in
  `docker-compose.yml`) – Rechte an `data/index` dann passend setzen.
