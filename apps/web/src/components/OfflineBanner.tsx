import { useI18n } from "../lib/i18n";
import { useOnline } from "../lib/pwa";

/**
 * Hinweis, wenn das Geraet offline ist. Scannen braucht den Server (OCR +
 * Bildvergleich laufen dort), deshalb sagen wir es klar, statt in einen
 * Zeitueberschreitungsfehler laufen zu lassen.
 */
export function OfflineBanner() {
  const { t } = useI18n();
  const online = useOnline();
  if (online) return null;

  return (
    <div
      data-testid="offline-banner"
      role="status"
      className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
    >
      <span className="font-semibold">{t("offlineTitle")}</span> {t("offlineHint")}
    </div>
  );
}
