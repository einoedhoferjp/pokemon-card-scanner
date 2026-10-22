import { useEffect, useRef, useState } from "react";
import type { CardSummary } from "@shared/types";
import { apiUrl, searchCards } from "../lib/api";
import { useI18n } from "../lib/i18n";

type Props = {
  onSelect: (card: CardSummary) => void;
  selectedId?: string | null;
  autoFocus?: boolean;
};

/** Manuelle Suche als Fallback, wenn die Erkennung die Karte nicht findet. */
export function ManualSearch({ onSelect, selectedId, autoFocus }: Props) {
  const { t, cardName, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const found = await searchCards(q, 20);
        if (alive) setResults(found);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
        {t("searchTitle")}
      </h3>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setTouched(true);
        }}
        placeholder={t("searchPlaceholder")}
        className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-base text-gray-100 placeholder:text-gray-500 focus:border-sky-500 focus:outline-none"
        inputMode="search"
        autoComplete="off"
      />

      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="text-xs text-gray-500">{t("searchHint")}</p>
      )}
      {loading && <p className="text-xs text-gray-500">…</p>}
      {touched && !loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-sm text-gray-400">{t("searchNoResults")}</p>
      )}

      <ul className="divide-y divide-gray-800 overflow-hidden rounded-xl border border-gray-800">
        {results.map((card) => {
          const selected = card.tcgdexId === selectedId;
          const img = apiUrl(card.imageUrl);
          return (
            <li key={card.tcgdexId}>
              <button
                type="button"
                data-testid="search-result"
                onClick={() => onSelect(card)}
                className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                  selected ? "bg-sky-500/15" : "hover:bg-gray-800/60"
                }`}
              >
                {img ? (
                  <img
                    src={img}
                    alt=""
                    loading="lazy"
                    className="h-16 w-12 flex-none rounded object-cover ring-1 ring-gray-700"
                  />
                ) : (
                  <div className="flex h-16 w-12 flex-none items-center justify-center rounded bg-gray-800 text-xs text-gray-500 ring-1 ring-gray-700">
                    {t("searchImageMissing")}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-100">{cardName(card)}</p>
                  <p className="truncate text-xs text-gray-400">
                    {card.setName ?? card.setId} · {t("cardNumber")} {card.number}
                    {card.rarity ? ` · ${card.rarity}` : ""}
                  </p>
                  <p className="truncate text-xs text-gray-500">{card.tcgdexId}</p>
                </div>
                {selected && <span className="text-xs text-sky-300">{t("resultSelected")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {lang !== "de" && results.length > 0 && (
        <p className="text-xs text-gray-600">IDs sind sprachunabhängig (TCGdex).</p>
      )}
    </div>
  );
}
