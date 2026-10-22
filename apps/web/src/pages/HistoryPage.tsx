import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Scan } from "@shared/types";
import { apiUrl, deleteScan, listScans } from "../lib/api";
import { statusKey, useI18n } from "../lib/i18n";
import { StatusBadge } from "../components/StatusBadge";
import { errorMessage } from "../lib/errors";

function displayName(scan: Scan, lang: "de" | "en"): string | null {
  const wanted = scan.chosenCardId ?? scan.autoCardId;
  const candidate =
    scan.candidates.find((c) => c.cardId === wanted) ?? (wanted ? null : scan.candidates[0]);
  if (!candidate) return null;
  return (
    (lang === "de"
      ? (candidate.nameDe ?? candidate.nameEn)
      : (candidate.nameEn ?? candidate.nameDe)) ?? candidate.cardId
  );
}

export function HistoryPage() {
  const { t, lang } = useI18n();
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setScans(await listScans(50));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm(t("historyDeleteConfirm"))) return;
      try {
        await deleteScan(id);
        setScans((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [t],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-lg font-semibold">{t("historyTitle")}</h1>
      {loading && <p className="text-sm text-gray-400">{t("historyLoad")}</p>}
      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}
      {!loading && scans.length === 0 && (
        <p className="text-sm text-gray-400">{t("historyEmpty")}</p>
      )}

      <ul className="space-y-2">
        {scans.map((scan) => {
          const img = apiUrl(scan.imageUrl);
          const name = displayName(scan, lang);
          return (
            <li
              key={scan.id}
              className="flex items-center gap-3 rounded-xl border border-gray-800 p-3"
            >
              <Link to={`/scan/${scan.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                {img ? (
                  <img
                    src={img}
                    alt=""
                    loading="lazy"
                    className="h-20 w-14 flex-none rounded object-cover ring-1 ring-gray-700"
                  />
                ) : (
                  <div className="h-20 w-14 flex-none rounded bg-gray-800 ring-1 ring-gray-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-100">{name ?? "–"}</p>
                  <p className="truncate text-xs text-gray-400">
                    {new Date(scan.createdAt).toLocaleString(lang === "de" ? "de-DE" : "en-GB")}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={scan.status} />
                    <span className="text-xs text-gray-500">
                      {t("confidence")} {scan.candidates[0]?.final.toFixed(2) ?? "–"}
                    </span>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => void remove(scan.id)}
                className="flex-none rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-300"
              >
                {t("historyDelete")}
              </button>
            </li>
          );
        })}
      </ul>

      {scans.length > 0 && (
        <p className="text-center text-xs text-gray-600">
          {scans.length} Scans · {t(statusKey("auto"))}:{" "}
          {scans.filter((s) => s.status === "auto").length} · {t(statusKey("corrected"))}:{" "}
          {scans.filter((s) => s.status === "corrected").length}
        </p>
      )}
    </div>
  );
}
