# PCS Web (React-PWA)

Kamera-Scan-Frontend. Deutsch als Standardsprache, umschaltbar auf Englisch
(Dictionary in `src/lib/i18n.tsx`, weitere Sprachen = ein weiteres Objekt).

## Ablauf

```
Scannen  →  Aufnahme/Galerie  →  Ergebnis prüfen  →  bestätigen/korrigieren/verwerfen
                                      ↕                              ↓
                            manuelle Suche (Fallback)        Sammlung (mit Konto)
```

- **Scannen** (`src/pages/ScanPage.tsx`): Kamerabild mit Kartenrahmen (63 × 88 mm),
  Live-Hinweise bei zu wenig Licht oder Verwacklung, Kamerawechsel, Auslöser.
  Ohne Kamera/HTTPS gibt es den Galerie-Upload als vollwertigen Weg.
- **Ergebnis prüfen** (`src/pages/ResultPage.tsx`): Scan-Foto **neben** dem
  Referenzbild, Top-3-Kandidaten mit Score und Einzelverfahren, Bestätigen,
  Korrigieren (Suche) oder Verwerfen, technische Details aufklappbar. Angemeldet
  zeigt die Seite den Sammlungsstand („n× in der Sammlung") und kann die Karte
  auch ohne Bestätigung übernehmen; anonym erscheint stattdessen der Anmelde-Hinweis.
- **Verlauf** (`src/pages/HistoryPage.tsx`): letzte Scans mit Status und Löschfunktion.
  Der Verlauf hängt am Browser (Cookie `pcs_anon`) bzw. am Konto – andere sehen ihn nicht.
- **Sammlung** (`src/pages/CollectionPage.tsx`): Überblick (Karten insgesamt, verschiedene
  Karten, Zustände, Top-Sets), Suche/Filter, Menge ±, Zustand ändern, Entfernen, Karte
  manuell über die Suche hinzufügen.
- **Kartendetail** (`src/pages/CardDetailPage.tsx`): Referenzbild, Set/Nummer/Rarity,
  Bestand und „hinzufügen" für angemeldete Nutzer.
- **Anmelden** (`src/pages/LoginPage.tsx`): Registrieren/Anmelden umschaltbar; die
  Anmeldung läuft über `AuthProvider` (`src/lib/auth.tsx`) und ein httpOnly-Cookie.

Alle API-Aufrufe senden Cookies mit (`credentials: "include"`). In der Entwicklung
sind Web (5173) und API (3000) derselbe Host, deshalb passt `SameSite=Lax`. Im
Deployment laufen Web und API hinter **einer** Domain (Caddy aus `deploy/`,
siehe [`DEPLOYMENT.md`](../../DEPLOYMENT.md)) – dann bleiben die Cookies
erst-parteiisch und `secure` (gesetzt über `NODE_ENV=production`) greift.
Wird stattdessen getrennt gehostet, müssen `CORS_ORIGINS` und die
Cookie-Einstellungen in `apps/api/src/auth/plugin.ts` angepasst werden.

## Konfiguration

| Variable       | Bedeutung                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | Basis-URL der API. Leer = automatisch: `http://localhost:3000`, im LAN `http(s)://<host>:3000`. **`same-origin`** (oder `/`) = alle Aufrufe relativ zur eigenen Herkunft – so wird das Deployment gebaut. |

## Befehle

```bash
npm run dev        # Vite-Dev-Server (0.0.0.0:5173)
npm run build      # tsc + Produktions-Build (dist/)
npm run test       # 13 Playwright-Tests, mobil (Pixel 7), braucht DB + rec + API
npm run icons      # PWA-/Favicon-Icons aus dem SVG in scripts/generate-icons.mjs
npm run lighthouse # Lighthouse gegen den Build (Punkte + HTML-Report)
```

Zusätzlich (nur gegen eine laufende HTTPS-Installation, sonst übersprungen):

```bash
PCS_DEPLOY_URL=https://<domain> npx playwright test tests/deployment.spec.ts
```

Der Test legt ein Konto an, scannt ein Foto über den Proxy und prüft dabei, dass
Referenz- und Scanbild geladen werden und **kein** API-Aufruf die Deployment-Herkunft
verlässt (gleiche Herkunft = ohne CORS, mit `Secure`-Cookies).

## PWA, Service Worker und Offline

`vite-plugin-pwa` erzeugt Service-Worker, Manifest (`/manifest.webmanifest`) und
Icons (inkl. maskable). `registerType: "autoUpdate"` aktualisiert installierte Apps
automatisch (mit `skipWaiting`/`clientsClaim`); die Icons entstehen reproduzierbar
über `npm run icons`.

Der Service Worker (`workbox` in `vite.config.ts`) arbeitet zweigleisig:

| Bereich                        | Strategie                    | Umfang                                        |
| ------------------------------ | ---------------------------- | --------------------------------------------- |
| App-Shell (HTML/JS/CSS/…)      | Precache (14 Einträge)       | ~400 KiB, `navigateFallback` auf `index.html` |
| Katalogbilder `/cards/*/image` | CacheFirst                   | 600 Bilder / 60 Tage                          |
| Kartendaten `/cards*` (GET)    | NetworkFirst (5 s)           | 200 Antworten / 14 Tage                       |
| Konten, Scans, Sammlung        | **kein Cache** (direkt Netz) | –                                             |

Der Cache ist bewusst auf den **Katalog** begrenzt: Sitzung, Scans und Sammlung
werden nicht gespeichert, damit auf einem geteilten Gerät keine fremden Daten
liegen bleiben.

Verhalten ohne Netz:

- Banner „Keine Verbindung“ (`src/components/OfflineBanner.tsx`, `useOnline`)
- Scan-Seite sperrt Auslöser und Galerie und sagt warum (`offlineHint`)
- Netzwerkfehler werden im API-Client (`src/lib/api.ts`) zu „Keine Verbindung zum
  Server – bitte Internet prüfen.“ statt „Failed to fetch“
- zuvor geladene Referenzbilder und Kartendetails bleiben sichtbar

Scannen selbst braucht den Server (OCR + Bildvergleich); eine Warteschlange für
offline aufgenommene Fotos gibt es bewusst nicht – sie würde die Prüfen-dann-Speichern-
Regel verwässern.

Der Installations-Hinweis (`src/components/InstallBanner.tsx`, `useInstallPrompt`)
erscheint nur, wenn der Browser die Installation anbietet (Chrome/Edge/Android via
`beforeinstallprompt`) oder auf iOS als kurzer Tipp („Teilen → Zum Home-Bildschirm“),
und lässt sich dauerhaft wegklicken (`localStorage`).

## Kamera und HTTPS

`getUserMedia` benötigt einen sicheren Kontext (`https://` oder `localhost`).
Auf dem Desktop funktioniert die Kamera mit `http://localhost:5173` direkt.
Für Handy-Tests im LAN gibt es zwei Wege: das Deployment mit HTTPS nutzen
(`DEPLOYMENT.md`, Caddy) oder – ohne HTTPS – den Galerie-Upload, den die
Scan-Seite automatisch anbietet.
