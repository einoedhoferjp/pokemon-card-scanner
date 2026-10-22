import type { CapacitorConfig } from "@capacitor/cli";

// Die iOS-App ist ein schlanker Client: Sie laedt die PWA von der laufenden
// Installation. Die Adresse wird beim Bauen gesetzt (siehe
// .github/workflows/ios.yml und IOS.md):
//
//   PCS_APP_URL=https://scanner.example.org npx cap sync ios
//
// Bewusst Pflicht: Ohne Adresse wuerde die App im WebView leer starten.
const appUrl = process.env.PCS_APP_URL?.trim();
if (!appUrl) {
  throw new Error(
    "PCS_APP_URL fehlt. Beispiel: PCS_APP_URL=https://scanner.example.org npx cap sync ios",
  );
}
if (!appUrl.startsWith("https://")) {
  throw new Error(`PCS_APP_URL muss mit https:// beginnen (Kamera braucht HTTPS): ${appUrl}`);
}

const config: CapacitorConfig = {
  // Bundle-ID: frei waehlbar, muss aber zu deiner Apple-ID passen (AltStore
  // signiert die App beim Installieren neu). Beim CI-Build ueberschreibbar.
  appId: process.env.PCS_APP_ID?.trim() || "de.pokemonscanner.app",
  appName: "PK-Scan",
  webDir: "dist",
  // Kein eingebettetes Web-Bundle: Die App laedt die PWA vom Server. Dadurch
  // gelten dieselbe Herkunft, dieselben Cookies und derselbe Service Worker
  // wie im Browser, und ein Server-Update wirkt sofort.
  server: {
    url: appUrl,
    // Wird geladen, wenn der Server nicht erreichbar ist (WKWebView-Navigation
    // schlaegt fehl). Die Seite liegt im Web-Bundle und nennt die Adresse.
    errorPath: "offline.html",
  },
  ios: {
    // Der WebView fuellt den Bildschirm; die sicheren Bereiche (Notch,
    // Home-Indikator) regelt das CSS ueber env(safe-area-inset-*).
    contentInset: "never",
    backgroundColor: "#030712",
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
};

export default config;
