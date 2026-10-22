// Mini-i18n (Deutsch als Standard, Englisch als zweite Sprache).
//
// Bewusst schlank: ein Dictionary + Context, keine Bibliothek. Weitere Sprachen
// = weiteres Objekt in `translations`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const LANGUAGES = ["de", "en"] as const;
export type Lang = (typeof LANGUAGES)[number];

const de = {
  appTitle: "Karten-Scanner",
  navScan: "Scannen",
  navHistory: "Verlauf",

  scanTitle: "Karte scannen",
  scanHint: "Karte im Rahmen ausrichten – Rand sichtbar lassen",
  scanButton: "Aufnahme",
  scanBusy: "Wird erkannt …",
  scanUploading: "Foto wird gesendet …",
  scanCancel: "Abbrechen",
  scanFromGallery: "Foto aus Galerie wählen",
  scanNoCamera: "Keine Kamera verfügbar – bitte ein Foto auswählen.",
  scanInsecure: "Kamera braucht HTTPS oder localhost – bitte ein Foto auswählen.",
  scanDarkHint: "Zu dunkel – mehr Licht hilft der Erkennung",
  scanBlurryHint: "Bitte ruhig halten",
  scanError: "Scan fehlgeschlagen",

  resultTitle: "Ergebnis prüfen",
  resultLoading: "Lade Ergebnis …",
  resultNotFound: "Scan nicht gefunden",
  resultYourPhoto: "Dein Foto",
  resultReference: "Referenzkarte",
  resultCandidates: "Kandidaten",
  resultAuto: "Automatisch erkannt",
  resultAutoHint: "Mehrere Erkennungsverfahren sind sich einig.",
  resultCheck: "Bitte bestätigen – sicher ist sicher.",
  resultConfirm: "Passt so",
  resultCorrect: "Andere Karte",
  resultReject: "Nicht dabei / verwerfen",
  resultSaved: "Gespeichert",
  resultSavedHint: "Karte wurde übernommen.",
  resultRejected: "Verworfen",
  resultRejectedHint: "Es wurde keine Karte gespeichert.",
  resultDetails: "Technische Details",
  resultReason: "Begründung",
  resultOcr: "OCR",
  resultQuality: "Bildqualität",
  resultBack: "Neuer Scan",
  resultChooseThis: "Diese Karte wählen",
  resultSelected: "Ausgewählt",
  resultNoCandidates: "Keine Kandidaten gefunden – bitte manuell suchen.",

  searchTitle: "Karte manuell suchen",
  searchPlaceholder: "Name oder Nummer, z. B. Glurak oder 4",
  searchNoResults: "Keine Treffer",
  searchHint: "Mindestens 2 Zeichen",
  searchImageMissing: "kein Bild",

  historyTitle: "Verlauf",
  historyEmpty: "Noch keine Scans.",
  historyLoad: "Lade Verlauf …",
  historyDelete: "Löschen",
  historyDeleteConfirm: "Diesen Scan mit Foto wirklich löschen?",
  statusPending: "zu prüfen",
  statusAuto: "automatisch",
  statusConfirmed: "bestätigt",
  statusCorrected: "korrigiert",
  statusRejected: "verworfen",

  confidence: "Sicherheit",
  cardNumber: "Nummer",
  set: "Set",
  language: "Sprache",

  // Anmeldung
  navCollection: "Sammlung",
  navLogin: "Anmelden",
  navLogout: "Abmelden",
  navProfile: "Profil",
  authLoginTitle: "Willkommen zurück",
  authRegisterTitle: "Konto anlegen",
  authEmail: "E-Mail",
  authPassword: "Passwort",
  authPasswordRepeat: "Passwort wiederholen",
  authDisplayName: "Anzeigename (optional)",
  authSubmitLogin: "Anmelden",
  authSubmitRegister: "Registrieren",
  authToRegister: "Noch kein Konto? Registrieren",
  authToLogin: "Schon ein Konto? Anmelden",
  authError: "Das hat nicht geklappt",
  authPasswordMismatch: "Die Passwörter stimmen nicht überein.",
  authHint:
    "Mit Konto landen automatisch erkannte und bestätigte Karten direkt in deiner Sammlung.",
  authSignedInAs: "Angemeldet als",
  authProfileTitle: "Profil",
  authCurrentPassword: "Aktuelles Passwort (nur für Passwortwechsel)",
  authNewPassword: "Neues Passwort",
  authSave: "Speichern",
  authSaved: "Gespeichert",
  authClaimedScans: "Bisherige Scans wurden übernommen",
  authRequired: "Bitte zuerst anmelden.",

  // Sammlung
  collectionTitle: "Meine Sammlung",
  collectionLoad: "Lade Sammlung …",
  collectionEmpty: "Noch keine Karten in der Sammlung.",
  collectionLoginRequired: "Bitte anmelden, um deine Sammlung zu sehen.",
  collectionUnique: "verschiedene Karten",
  collectionTotal: "Karten insgesamt",
  collectionAdd: "Karte hinzufügen",
  collectionAddTitle: "Karte manuell hinzufügen",
  collectionSearchPlaceholder: "In der Sammlung suchen",
  collectionQuantity: "Anzahl",
  collectionCondition: "Zustand",
  collectionNotes: "Notiz",
  collectionNotesPlaceholder: "z. B. erste Edition, leichte Kratzer",
  collectionRemove: "Entfernen",
  collectionRemoveConfirm: "Karte wirklich aus der Sammlung entfernen?",
  collectionAdded: "Zur Sammlung hinzugefügt",
  collectionAddedHint: "Die Karte liegt jetzt in deiner Sammlung.",
  collectionLoginHint: "Melde dich an, damit diese Karte in deiner Sammlung landet.",
  collectionLoginToAdd: "Zum Sammeln anmelden",
  collectionOwned: "{n}× in der Sammlung",
  collectionStats: "Überblick",
  collectionTopSets: "Top-Sets",
  collectionMore: "Mehr",
  collectionLess: "Weniger",
  collectionAll: "Alle",
  collectionFilterCondition: "Zustand",
  collectionSave: "Speichern",

  conditionMint: "Mint",
  conditionNearMint: "Near Mint",
  conditionExcellent: "Excellent",
  conditionGood: "Good",
  conditionPlayed: "Played",
  conditionPoor: "Poor",

  // PWA / offline
  offlineTitle: "Keine Verbindung.",
  offlineHint: "Scannen braucht Internet – bereits geladene Bilder bleiben sichtbar.",
  installTitle: "Als App installieren",
  installHint: "Für Vollbild und schnellen Zugriff vom Startbildschirm.",
  installIosHint: "Teilen-Symbol antippen → „Zum Home-Bildschirm“.",
  installAction: "Installieren",
  installDismiss: "Hinweis schließen",
} as const;

const en: Record<keyof typeof de, string> = {
  appTitle: "Card Scanner",
  navScan: "Scan",
  navHistory: "History",

  scanTitle: "Scan a card",
  scanHint: "Align the card inside the frame – keep the edges visible",
  scanButton: "Capture",
  scanBusy: "Recognising …",
  scanUploading: "Sending photo …",
  scanCancel: "Cancel",
  scanFromGallery: "Choose photo from gallery",
  scanNoCamera: "No camera available – please choose a photo.",
  scanInsecure: "Camera requires HTTPS or localhost – please choose a photo.",
  scanDarkHint: "Too dark – more light helps recognition",
  scanBlurryHint: "Please hold steady",
  scanError: "Scan failed",

  resultTitle: "Check result",
  resultLoading: "Loading result …",
  resultNotFound: "Scan not found",
  resultYourPhoto: "Your photo",
  resultReference: "Reference card",
  resultCandidates: "Candidates",
  resultAuto: "Recognised automatically",
  resultAutoHint: "Several recognition methods agree.",
  resultCheck: "Please confirm – better safe than sorry.",
  resultConfirm: "Looks right",
  resultCorrect: "Different card",
  resultReject: "Not available / discard",
  resultSaved: "Saved",
  resultSavedHint: "Card was added.",
  resultRejected: "Discarded",
  resultRejectedHint: "No card was saved.",
  resultDetails: "Technical details",
  resultReason: "Reason",
  resultOcr: "OCR",
  resultQuality: "Image quality",
  resultBack: "New scan",
  resultChooseThis: "Choose this card",
  resultSelected: "Selected",
  resultNoCandidates: "No candidates found – please search manually.",

  searchTitle: "Search card manually",
  searchPlaceholder: "Name or number, e.g. Charizard or 4",
  searchNoResults: "No matches",
  searchHint: "At least 2 characters",
  searchImageMissing: "no image",

  historyTitle: "History",
  historyEmpty: "No scans yet.",
  historyLoad: "Loading history …",
  historyDelete: "Delete",
  historyDeleteConfirm: "Really delete this scan and its photo?",
  statusPending: "to check",
  statusAuto: "automatic",
  statusConfirmed: "confirmed",
  statusCorrected: "corrected",
  statusRejected: "discarded",

  confidence: "Confidence",
  cardNumber: "Number",
  set: "Set",
  language: "Language",

  // Authentication
  navCollection: "Collection",
  navLogin: "Sign in",
  navLogout: "Sign out",
  navProfile: "Profile",
  authLoginTitle: "Welcome back",
  authRegisterTitle: "Create account",
  authEmail: "Email",
  authPassword: "Password",
  authPasswordRepeat: "Repeat password",
  authDisplayName: "Display name (optional)",
  authSubmitLogin: "Sign in",
  authSubmitRegister: "Sign up",
  authToRegister: "No account yet? Sign up",
  authToLogin: "Already have an account? Sign in",
  authError: "That did not work",
  authPasswordMismatch: "The passwords do not match.",
  authHint:
    "With an account, automatically recognised and confirmed cards go straight into your collection.",
  authSignedInAs: "Signed in as",
  authProfileTitle: "Profile",
  authCurrentPassword: "Current password (only to change it)",
  authNewPassword: "New password",
  authSave: "Save",
  authSaved: "Saved",
  authClaimedScans: "Previous scans were taken over",
  authRequired: "Please sign in first.",

  // Collection
  collectionTitle: "My collection",
  collectionLoad: "Loading collection …",
  collectionEmpty: "No cards in your collection yet.",
  collectionLoginRequired: "Please sign in to see your collection.",
  collectionUnique: "different cards",
  collectionTotal: "cards in total",
  collectionAdd: "Add card",
  collectionAddTitle: "Add a card manually",
  collectionSearchPlaceholder: "Search in collection",
  collectionQuantity: "Quantity",
  collectionCondition: "Condition",
  collectionNotes: "Note",
  collectionNotesPlaceholder: "e.g. first edition, light scratches",
  collectionRemove: "Remove",
  collectionRemoveConfirm: "Really remove this card from your collection?",
  collectionAdded: "Added to collection",
  collectionAddedHint: "The card is now in your collection.",
  collectionLoginHint: "Sign in so this card ends up in your collection.",
  collectionLoginToAdd: "Sign in to collect",
  collectionOwned: "{n}× in collection",
  collectionStats: "Overview",
  collectionTopSets: "Top sets",
  collectionMore: "More",
  collectionLess: "Less",
  collectionAll: "All",
  collectionFilterCondition: "Condition",
  collectionSave: "Save",

  conditionMint: "Mint",
  conditionNearMint: "Near Mint",
  conditionExcellent: "Excellent",
  conditionGood: "Good",
  conditionPlayed: "Played",
  conditionPoor: "Poor",

  // PWA / offline
  offlineTitle: "No connection.",
  offlineHint: "Scanning needs the internet – images already loaded stay visible.",
  installTitle: "Install as an app",
  installHint: "Full screen and quick access from your home screen.",
  installIosHint: "Tap the share icon → “Add to Home Screen”.",
  installAction: "Install",
  installDismiss: "Dismiss hint",
};

export type TranslationKey = keyof typeof de;
const translations: Record<Lang, Record<TranslationKey, string>> = { de, en };

const STORAGE_KEY = "pcs.lang";

function detectLang(): Lang {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored === "de" || stored === "en") return stored;
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "de";
  return nav.startsWith("de") ? "de" : "en";
}

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
  /** Kartenname bevorzugt in UI-Sprache. */
  cardName: (card: { nameDe: string | null; nameEn: string | null }) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback((key: TranslationKey) => translations[lang][key], [lang]);
  const cardName = useCallback(
    (card: { nameDe: string | null; nameEn: string | null }) =>
      (lang === "de" ? (card.nameDe ?? card.nameEn) : (card.nameEn ?? card.nameDe)) ?? "?",
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, cardName }), [lang, setLang, t, cardName]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n muss innerhalb von I18nProvider verwendet werden");
  return ctx;
}

export function statusKey(status: string): TranslationKey {
  switch (status) {
    case "auto":
      return "statusAuto";
    case "confirmed":
      return "statusConfirmed";
    case "corrected":
      return "statusCorrected";
    case "rejected":
      return "statusRejected";
    default:
      return "statusPending";
  }
}

export function conditionKey(condition: string): TranslationKey {
  switch (condition) {
    case "mint":
      return "conditionMint";
    case "excellent":
      return "conditionExcellent";
    case "good":
      return "conditionGood";
    case "played":
      return "conditionPlayed";
    case "poor":
      return "conditionPoor";
    default:
      return "conditionNearMint";
  }
}
