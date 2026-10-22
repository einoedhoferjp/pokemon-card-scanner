// PWA-Helfer: Online-Status und Installations-Aufforderung.
//
// Bewusst ohne Fremdpaket: `navigator.onLine` + die Events `online`/`offline`
// reichen, um dem Nutzer zu sagen, warum gerade nichts geht. Die Installation
// bietet der Browser über `beforeinstallprompt` an (Chrome/Edge/Android);
// iOS-Safari kennt das Event nicht und bekommt einen kurzen Tipp.

import { useCallback, useEffect, useState } from "react";

/** Ist das Geraet gerade online? Reagiert auf online/offline-Ereignisse. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Beim Zurueckkommen aus dem Hintergrund kann der Status veraltet sein.
    const check = () => setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return online;
}

/** Laeuft die App bereits als installierte App (Vollbild)? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // In der nativen Huelle (Capacitor, z. B. die iOS-App) gibt es keinen
  // Installations-Hinweis: die App ist schon installiert.
  const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (native?.isNativePlatform?.() === true) return true;
  const standaloneMedia = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return standaloneMedia || iosStandalone;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = {
  /** Soll der Installations-Hinweis angezeigt werden? */
  visible: boolean;
  /** iOS: kein Installations-Event, nur ein Hinweis auf "Zum Home-Bildschirm". */
  ios: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
};

const DISMISS_KEY = "pcs.install.dismissed";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS meldet sich als Macintosh, erkennen wir an der Touch-Unterstuetzung.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function useInstallPrompt(): InstallState {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Standard-Hinweisleiste des Browsers unterdruecken - wir fragen selbst.
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* egal – dann erscheint der Hinweis eben wieder */
    }
    setDismissed(true);
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      /* abgebrochen ist kein Fehler */
    }
    setEvent(null);
  }, [event]);

  const ios = isIos() && !installed;
  return {
    visible: !dismissed && !installed && (event !== null || ios),
    ios: ios && event === null,
    install,
    dismiss,
  };
}
