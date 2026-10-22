import { useI18n } from "../lib/i18n";
import { useInstallPrompt } from "../lib/pwa";

/**
 * Dezente Aufforderung, die PWA auf den Startbildschirm zu legen.
 * Erscheint nur, wenn der Browser die Installation anbietet (Chrome/Edge/Android)
 * bzw. auf iOS als reiner Hinweis, und laesst sich dauerhaft wegklicken.
 */
export function InstallBanner() {
  const { t } = useI18n();
  const { visible, ios, install, dismiss } = useInstallPrompt();
  if (!visible) return null;

  return (
    <div
      data-testid="install-banner"
      className="flex items-center gap-3 border-b border-sky-500/30 bg-sky-500/10 px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-sky-100">{t("installTitle")}</p>
        <p className="text-xs leading-tight text-sky-200">
          {ios ? t("installIosHint") : t("installHint")}
        </p>
      </div>

      {!ios && (
        <button
          type="button"
          data-testid="install-action"
          onClick={() => void install()}
          className="flex-none rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white"
        >
          {t("installAction")}
        </button>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label={t("installDismiss")}
        className="flex-none rounded-lg border border-sky-500/40 px-2 py-1.5 text-xs text-sky-100"
      >
        ✕
      </button>
    </div>
  );
}
