import { statusKey, useI18n } from "../lib/i18n";

const STYLES: Record<string, string> = {
  auto: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  confirmed: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  corrected: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  pending: "bg-gray-500/15 text-gray-300 border-gray-500/40",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        STYLES[status] ?? STYLES.pending
      }`}
    >
      {t(statusKey(status))}
    </span>
  );
}
