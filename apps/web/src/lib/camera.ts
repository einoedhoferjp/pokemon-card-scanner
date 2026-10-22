// Kamera-Zugriff (Rückkamera bevorzugt) + Aufnahme + einfache Qualitätshinweise.
//
// Wichtig: getUserMedia funktioniert nur in einem "secure context"
// (https:// oder http://localhost). Auf einem Handy im LAN braucht es daher
// HTTPS – sonst fällt die Scan-Seite auf die Galerie-Auswahl zurück.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorName } from "./errors";

export type CameraError = "insecure" | "unavailable" | "denied" | null;

export type CameraHint = "dark" | "blurry" | null;

export type UseCamera = {
  ready: boolean;
  error: CameraError;
  /** Anzahl gefundener Video-Eingänge (0 = keine Kamera). */
  deviceCount: number;
  facing: "environment" | "user";
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => void;
};

/**
 * Startet die Kamera und liefert Zustand + Aktionen.
 *
 * Das `videoRef` bekommt die aufrufende Komponente uebergeben: sie rendert das
 * `<video>`-Element und haelt den Ref damit selbst. So enthaelt das
 * zurueckgegebene Objekt keinen Ref (sonst ist fuer den Aufrufer nicht mehr
 * unterscheidbar, was Ref und was Zustand ist).
 */
export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>): UseCamera {
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError>(null);
  const [deviceCount, setDeviceCount] = useState(0);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, [videoRef]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext === false ? "insecure" : "unavailable");
      return;
    }
    try {
      stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play().catch(() => undefined);
      }
      setReady(true);

      // Geräteliste (erst nach erteilter Erlaubnis vollständig)
      const devices = await navigator.mediaDevices.enumerateDevices();
      setDeviceCount(devices.filter((d) => d.kind === "videoinput").length);
    } catch (e) {
      const name = errorName(e);
      if (name === "NotAllowedError" || name === "SecurityError") setError("denied");
      else if (typeof window !== "undefined" && window.isSecureContext === false)
        setError("insecure");
      else setError("unavailable");
    }
  }, [facing, stop, videoRef]);

  const switchCamera = useCallback(() => {
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }, []);

  // Bei Kamerawechsel neu starten (nicht beim ersten Rendern).
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) return;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  useEffect(() => stop, [stop]);

  const startOnce = useCallback(async () => {
    started.current = true;
    await start();
  }, [start]);

  return { ready, error, deviceCount, facing, start: startOnce, stop, switchCamera };
}

/** Zieht ein Bild aus dem Video (max. Kantenlänge) und liefert ein JPEG-Blob. */
export function captureFrame(
  video: HTMLVideoElement,
  maxEdge = 2200,
  quality = 0.9,
): Promise<Blob> {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas nicht verfügbar"));
  ctx.drawImage(video, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Aufnahme fehlgeschlagen"))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Einfache Live-Qualitätsprüfung auf einem Ausschnitt der Bildmitte:
 * Helligkeit (Mittelwert) und Schärfe (Varianz der Laplace-Antwort).
 * Kein Ersatz für die Server-Prüfung, nur ein Hinweis für den Nutzer.
 */
export function assessFrame(video: HTMLVideoElement): CameraHint {
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (!vw || !vh) return null;
  const side = Math.min(vw, vh) * 0.7;
  ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const gray = new Float32Array(size * size);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    sum += g;
  }
  const mean = sum / gray.length;

  let gradSum = 0;
  let gradSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
      gradSum += lap;
      gradSq += lap * lap;
      n++;
    }
  }
  const gradVar = n > 0 ? gradSq / n - (gradSum / n) ** 2 : 0;

  // Schwellen bewusst tolerant: nur deutliche Probleme melden.
  if (mean < 55) return "dark";
  if (gradVar < 12) return "blurry";
  return null;
}
