import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { assessFrame, captureFrame, useCamera } from "../lib/camera";
import { ApiError, createScan } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useOnline } from "../lib/pwa";
import { errorMessage } from "../lib/errors";

const HINT_INTERVAL_MS = 800;

export function ScanPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const online = useOnline();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cam = useCamera(videoRef);
  const [hint, setHint] = useState<"dark" | "blurry" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Kamera beim Öffnen starten, beim Verlassen freigeben
  useEffect(() => {
    void cam.start();
    return () => cam.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-Hinweise (Helligkeit/Schärfe)
  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (video && video.readyState >= 2) setHint(assessFrame(video));
    }, HINT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [videoRef]);

  const submit = useCallback(
    async (blob: Blob, name: string) => {
      // Ohne Verbindung laeuft die Erkennung nicht (OCR + Vergleich auf dem Server).
      // Lieber gleich sagen als in einen Netzwerkfehler laufen.
      if (!navigator.onLine) {
        setError(t("offlineHint"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const scan = await createScan(blob, name);
        navigate(`/scan/${scan.id}`);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : errorMessage(e);
        setError(`${t("scanError")}: ${msg}`);
        setBusy(false);
      }
    },
    [navigate, t],
  );

  const onCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const blob = await captureFrame(video);
      await submit(blob, "scan.jpg");
    } catch (e) {
      setError(`${t("scanError")}: ${errorMessage(e)}`);
    }
  }, [videoRef, submit, t]);

  const cameraBroken = cam.error !== null;

  return (
    <div className="app-page-full flex flex-col">
      <div className="relative flex-1 overflow-hidden bg-black">
        {!cameraBroken && (
          <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
        )}

        {/* Kartenrahmen (63 × 88 mm) */}
        {!cameraBroken && cam.ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[76%] aspect-[63/88] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              <span className="absolute -bottom-7 left-1/2 w-[140%] -translate-x-1/2 text-center text-xs text-white/90 drop-shadow">
                {t("scanHint")}
              </span>
            </div>
          </div>
        )}

        {cameraBroken && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm text-gray-300">
              {cam.error === "insecure" ? t("scanInsecure") : t("scanNoCamera")}
            </p>
          </div>
        )}

        {hint && cam.ready && !busy && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-gray-900">
            {hint === "dark" ? t("scanDarkHint") : t("scanBlurryHint")}
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-500 border-t-white" />
            <p className="text-sm text-gray-200">{t("scanBusy")}</p>
            <p className="max-w-xs text-center text-xs text-gray-400">
              OCR + Bildvergleich laufen auf dem Server (ca. 1–3 s).
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-gray-800 bg-gray-900 p-4">
        {error && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        {!online && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            {t("offlineHint")}
          </p>
        )}

        <div className="flex items-center justify-center gap-4">
          {/*
            Ausdrücklich KEIN capture="environment": das erzwingt auf iOS und
            Android die Kamera und nimmt die Auswahl aus der Fotomediathek weg -
            der Knopf heißt aber "Aus Galerie". Die Formate sind einzeln
            aufgezählt, damit Safari HEIC-Fotos aus der Mediathek nach JPEG
            wandelt (bei "image/*" reicht iOS die Datei unverändert weiter, und
            die API akzeptiert nur JPEG/PNG/WebP).
          */}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void submit(file, file.name || "scan.jpg");
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !online}
            className="rounded-xl border border-gray-700 px-4 py-3 text-sm text-gray-200 disabled:opacity-40"
          >
            {t("scanFromGallery")}
          </button>

          {!cameraBroken && (
            <button
              type="button"
              onClick={onCapture}
              disabled={busy || !online || !cam.ready}
              aria-label={t("scanButton")}
              className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition active:scale-95 disabled:opacity-40"
            />
          )}

          {cam.deviceCount > 1 && !cameraBroken && (
            <button
              type="button"
              onClick={cam.switchCamera}
              disabled={busy}
              className="rounded-xl border border-gray-700 px-4 py-3 text-sm text-gray-200 disabled:opacity-40"
            >
              ⟳
            </button>
          )}
        </div>

        {cam.deviceCount === 1 && <div className="h-[52px]" aria-hidden />}
      </div>
    </div>
  );
}
