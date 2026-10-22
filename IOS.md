# iOS-App (`.ipa`) bauen und auf dem iPhone installieren

Dieses Dokument beschreibt den Weg von GitHub zu einer installierten App auf dem
iPhone – ohne Mac, ohne Apple-Entwicklerkonto, ohne App Store.

Die `.ipa` enthält **kein** Web-Bundle: Sie ist eine native Hülle (Capacitor), die
beim Start die PWA von deiner Installation lädt (`server.url`). Dadurch gelten im
WebView dieselbe Herkunft, dieselben Cookies und derselbe Service Worker wie im
Browser, und Änderungen an der Web-App wirken sofort – ohne neuen Build.

```
GitHub Actions (macOS)  →  unsignierte .ipa  →  AltStore signiert mit deiner
                                                  Apple-ID und installiert
```

## Was du brauchst

| Sache                                                | Warum                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GitHub-Repository mit diesem Code (privat empfohlen) | Der Build läuft auf einem macOS-Runner von GitHub.                                               |
| iPhone mit iOS 15 oder neuer                         | Mindestversion von Capacitor 8.                                                                  |
| AltStore + AltServer                                 | Signiert und installiert die `.ipa` mit deiner Apple-ID.                                         |
| Apple-ID (kostenlos genügt)                          | AltStore signiert beim Installieren; freie Konten: 7 Tage, danach erneuert AltStore automatisch. |
| Erreichbare HTTPS-Installation                       | Die App lädt die PWA vom Server – ohne Server bleibt die App leer.                               |

Die Signatur passiert **erst auf dem Gerät**. Deshalb braucht der Workflow keine
Zertifikate, keine Secrets und kein Apple-Entwicklerkonto.

## 1. Repository zu GitHub

Das Projekt ist bereits als lokales Git-Repository angelegt und committet
(`main`), und es enthält keine Geheimnisse (`.env` und `data/` sind ignoriert).
Ein **privates** Repository ist trotzdem die bessere Wahl: es enthält den
Quellcode, keine Scans.

```bash
# Repository auf github.com anlegen (privat), dann:
git remote add origin https://github.com/<dein-name>/<repo>.git   # oder git@github.com:...
git push -u origin main
```

Für den Push braucht GitHub eine Anmeldung: entweder ein **Personal Access
Token** als Passwort (Settings → Developer settings → Tokens) oder ein
SSH-Schlüssel (`ssh-keygen`, öffentlichen Schlüssel bei GitHub hinterlegen).

Der Commit stammt vom Platzhalter-Autor `PK-Scan`. Mit eigener Identität:

```bash
git config --global user.name "Dein Name"
git config --global user.email "du@example.com"
git commit --amend --reset-author --no-edit
```

## 2. IPA bauen

**Variante A – Knopf im Browser (empfohlen):**

1. Repository → **Actions** → links **iOS-App (IPA)** → **Run workflow**.
2. `app_url` eintragen: die HTTPS-Adresse deiner Installation, z. B.
   `https://scanner.example.org` oder im LAN `https://192.168.1.50`.
   (Pflicht – ein Build ohne Adresse bricht mit einer Meldung ab, statt eine
   nutzlose App zu erzeugen.)
3. Optional `bundle_id` (Standard `de.pokemonscanner.app`) und `version`.
4. **Run workflow** → der Lauf dauert ca. 5–10 Minuten.

**Variante B – Tag (für eine feste Version):**

1. Repository → Settings → Secrets and variables → **Actions** → Variables →
   `PCS_APP_URL` anlegen (z. B. `https://scanner.example.org`).
2. `git tag ios-v1.0.0 && git push origin ios-v1.0.0`

Bei einem Tag landet die `.ipa` zusätzlich als **Release** unter „Releases“.

## 3. IPA herunterladen

- **Artefakt:** Actions → den Lauf öffnen → unten **Artifacts** → `PK-Scan-ipa`
  herunterladen (ein ZIP, darin `PK-Scan.ipa`). Artefakte sind 30 Tage verfügbar.
- **Release:** bei Tag-Builds unter **Releases** direkt als `PK-Scan.ipa`.

Der Download funktioniert auch am iPhone (Safari) – die Datei landet dann in
„Dateien“ → „Downloads“.

## 4. Mit AltStore installieren

1. AltServer auf Mac/PC installieren und starten, iPhone per USB oder WLAN
   verbinden, AltStore auf dem iPhone installieren (siehe altstore.io).
2. `PK-Scan.ipa` in die **Dateien**-App aufs iPhone bringen (AirDrop, iCloud
   Drive, Kabel) – oder am Rechner bleiben und AltServer nutzen.
3. **Auf dem iPhone:** AltStore → **My Apps** → **+** → die `.ipa` auswählen.
   **Am Rechner:** AltServer-Menü → _Sideload .ipa_ → Gerät und Datei wählen.
4. Beim ersten Start: Einstellungen → Allgemein → **VPN & Geräteverwaltung** →
   deine Apple-ID → _Vertrauen_. (iOS verlangt das für selbst signierte Apps.)
5. Bundle-ID und Apple-ID: AltStore signiert die App mit deiner Apple-ID. Die
   Bundle-ID muss eindeutig sein, aber **nicht** zu deinem Namen passen; der
   Standard `de.pokemonscanner.app` funktioniert. Für einen zweiten Build mit
   anderen Einstellungen einfach eine andere ID im Workflow eintragen.

Nach 7 Tagen (kostenlose Apple-ID) läuft die Signatur ab. AltStore erneuert sie
automatisch, solange AltServer im selben Netz läuft und die App installiert ist.

## 5. Server-Adresse und Zertifikat

Die Adresse wird beim Build fest in die App geschrieben. Sie muss:

- mit `https://` beginnen (der Workflow lehnt `http://` ab – Kamera und
  `__Host-`-Cookies brauchen HTTPS),
- vom iPhone erreichbar sein (öffentliche Domain oder LAN),
- ein **vertrauenswürdiges** Zertifikat haben.

Bei der eigenen CA (`PCS_TLS_MODE=internal`) muss das Root-Zertifikat wie in
[DEPLOYMENT.md](DEPLOYMENT.md#auf-dem-iphone-testen) beschrieben auf dem iPhone
installiert **und** unter „Zertifikatsvertrauen“ aktiviert sein – sonst blockt
WKWebView die Seite (leerer Bildschirm). Für den Zugriff auf Adressen im LAN
enthält die App bereits `NSLocalNetworkUsageDescription`; iOS fragt beim ersten
Zugriff nach der Freigabe.

Spätere Änderungen an der Web-App brauchen **keinen** neuen Build: die App lädt
immer die aktuelle Version vom Server. Ein neuer Build ist nur nötig, wenn sich
die Hülle ändert (Server-Adresse, Bundle-ID, Version, Icon, Berechtigungen).

Ist der Server nicht erreichbar (WLAN, falsche Adresse, nicht vertrautes
Zertifikat), zeigt die App statt einer leeren Fläche eine eigene Fehlerseite mit
der eingebauten Adresse und einem Knopf „Erneut versuchen“.

## 6. Grenzen

- **Kein App Store.** Apps, die eine Remote-URL laden, sind dort nicht
  zugelassen. Der Weg ist bewusst Sideloading über AltStore.
- **Erster Start braucht Netz.** Ohne Server zeigt der WebView nichts an; der
  Service Worker hilft erst nach dem ersten erfolgreichen Laden.
- **Kein Offline-Scannen.** OCR und Bildvergleich laufen auf dem Server.
- **7-Tage-Signatur** bei kostenloser Apple-ID (AltStore erneuert automatisch).
- **Nur iOS 15+**, nur Hochkant (wie das PWA-Manifest).
- Sicherheit: Installiere nur `.ipa`-Dateien aus deinem eigenen Repository.
  Fremde Dateien können beliebigen Code enthalten.

## 7. Lokal bauen (nur macOS)

Auf Linux/Windows lässt sich das Xcode-Projekt nicht bauen – dafür ist der
Workflow da. Mit einem Mac:

```bash
# 1) Web-App bauen, iOS-Projekt synchronisieren
cd apps/web
VITE_API_URL=same-origin pnpm build
PCS_APP_URL=https://scanner.example.org npx cap sync ios

# 2) Icons/Startbildschirm (nach Änderungen am Motiv)
node scripts/generate-ios-assets.mjs

# 3) In Xcode öffnen (Scheme "App", Signierung eigenem Team zuweisen)
npx cap open ios
```

Aufbau des Projekts:

```
apps/web/capacitor.config.ts          App-ID, Name, server.url (aus PCS_APP_URL)
apps/web/ios/App/App.xcodeproj        Xcode-Projekt (Scheme "App", iOS 15+)
apps/web/ios/App/App/Info.plist       Kamera-/Foto-/LAN-Berechtigungen, Hochkant
apps/web/ios/App/App/Assets.xcassets  Icon (1024) und Startbildschirm
apps/web/scripts/generate-ios-assets.mjs  erzeugt Icon/Splash aus dem PWA-Motiv
.github/workflows/ios.yml             Build der unsignierten .ipa
```

`npx cap sync ios` erzeugt `App/App/capacitor.config.json` und `App/App/public`;
beides ist (wie in `apps/web/ios/.gitignore` festgelegt) nicht versioniert.
