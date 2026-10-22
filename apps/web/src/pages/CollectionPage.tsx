import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CardCondition, CardSummary, CollectionItem, CollectionStats } from "@shared/types";
import { CARD_CONDITIONS } from "@shared/types";
import {
  addToCollection,
  apiUrl,
  collectionStats,
  listCollection,
  removeCollectionItem,
  updateCollectionItem,
} from "../lib/api";
import { conditionKey, useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { ManualSearch } from "../components/ManualSearch";
import { errorMessage } from "../lib/errors";

export function CollectionPage() {
  const { t, cardName } = useI18n();
  const { user, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<CollectionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState<CardCondition | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [list, s] = await Promise.all([
        listCollection({
          q: query.trim() || undefined,
          condition: condition || undefined,
          limit: 200,
        }),
        collectionStats(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setTotalCards(list.totalCards);
      setStats(s);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [user, query, condition]);

  useEffect(() => {
    void load();
  }, [load]);

  const addCard = useCallback(
    async (card: CardSummary) => {
      try {
        await addToCollection({ cardId: card.tcgdexId });
        setNotice(`${cardName(card)} – ${t("collectionAdded")}`);
        setShowAdd(false);
        await load();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [cardName, load, t],
  );

  const change = useCallback(
    async (item: CollectionItem, patch: { quantity?: number; condition?: CardCondition }) => {
      try {
        // Optimistisch anzeigen, danach echte Antwort übernehmen
        await updateCollectionItem(item.id, patch);
        await load();
      } catch (e) {
        setError(errorMessage(e));
        await load();
      }
    },
    [load],
  );

  const remove = useCallback(
    async (item: CollectionItem) => {
      if (!window.confirm(t("collectionRemoveConfirm"))) return;
      try {
        await removeCollectionItem(item.id);
        await load();
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [load, t],
  );

  if (authLoading) {
    return <p className="p-6 text-center text-sm text-gray-400">{t("collectionLoad")}</p>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("collectionTitle")}</h1>
        <p className="text-sm text-gray-400">{t("collectionLoginRequired")}</p>
        <Link
          to="/anmelden"
          className="inline-block rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white"
        >
          {t("navLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("collectionTitle")}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-200"
          >
            {t("collectionAdd")}
          </button>
          <button
            type="button"
            onClick={() => void logout().then(() => navigate("/"))}
            className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-400"
          >
            {t("navLogout")}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {t("authSignedInAs")} {user.displayName ?? user.email}
      </p>

      {/* Überblick */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-800 p-3">
          <p className="text-2xl font-semibold">{totalCards}</p>
          <p className="text-xs text-gray-400">{t("collectionTotal")}</p>
        </div>
        <div className="rounded-xl border border-gray-800 p-3">
          <p className="text-2xl font-semibold">{stats?.uniqueCards ?? total}</p>
          <p className="text-xs text-gray-400">{t("collectionUnique")}</p>
        </div>
      </div>

      {stats && stats.byCondition.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.byCondition.map((c) => (
            <span
              key={c.condition}
              className="rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-xs text-gray-300"
            >
              {t(conditionKey(c.condition))}: {c.totalCards}
            </span>
          ))}
        </div>
      )}

      {stats && stats.topSets.length > 0 && (
        <details className="rounded-xl border border-gray-800 p-3 text-sm text-gray-300">
          <summary className="cursor-pointer text-gray-400">{t("collectionTopSets")}</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {stats.topSets.map((s) => (
              <li key={s.setId} className="flex justify-between gap-3">
                <span className="truncate">{s.setName ?? s.setId}</span>
                <span className="flex-none text-gray-400">
                  {s.uniqueCards} / {s.totalCards}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {notice && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {showAdd && (
        <section className="rounded-xl border border-gray-800 p-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            {t("collectionAddTitle")}
          </h2>
          <ManualSearch onSelect={addCard} />
        </section>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("collectionSearchPlaceholder")}
          className="min-w-[12rem] flex-1 rounded-xl border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-100 focus:border-sky-500 focus:outline-none"
          inputMode="search"
        />
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as CardCondition | "")}
          aria-label={t("collectionFilterCondition")}
          className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        >
          <option value="">{t("collectionAll")}</option>
          {CARD_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {t(conditionKey(c))}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-gray-400">{t("collectionLoad")}</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-gray-400">{t("collectionEmpty")}</p>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          const img = apiUrl(item.card.imageUrl);
          return (
            <li
              key={item.id}
              data-testid="collection-item"
              className="flex gap-3 rounded-xl border border-gray-800 p-3"
            >
              <Link to={`/karte/${encodeURIComponent(item.card.tcgdexId)}`} className="flex-none">
                {img ? (
                  <img
                    src={img}
                    alt=""
                    loading="lazy"
                    className="h-24 w-[4.25rem] rounded object-cover ring-1 ring-gray-700"
                  />
                ) : (
                  <div className="h-24 w-[4.25rem] rounded bg-gray-800 ring-1 ring-gray-700" />
                )}
              </Link>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-medium text-gray-100">{cardName(item.card)}</p>
                <p className="truncate text-xs text-gray-400">
                  {item.card.setName ?? item.card.setId} · {t("cardNumber")} {item.card.number}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center overflow-hidden rounded-lg border border-gray-700">
                    <button
                      type="button"
                      aria-label={t("collectionLess")}
                      onClick={() =>
                        void change(item, { quantity: Math.max(1, item.quantity - 1) })
                      }
                      className="px-2.5 py-1 text-sm text-gray-200 disabled:opacity-40"
                      disabled={item.quantity <= 1}
                    >
                      −
                    </button>
                    <span
                      className="min-w-8 px-1 text-center text-sm"
                      data-testid="quantity"
                      aria-label={t("collectionQuantity")}
                    >
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={t("collectionMore")}
                      onClick={() =>
                        void change(item, { quantity: Math.min(999, item.quantity + 1) })
                      }
                      className="px-2.5 py-1 text-sm text-gray-200"
                    >
                      +
                    </button>
                  </div>

                  <select
                    value={item.condition}
                    aria-label={t("collectionCondition")}
                    data-testid="condition"
                    onChange={(e) =>
                      void change(item, { condition: e.target.value as CardCondition })
                    }
                    className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
                  >
                    {CARD_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {t(conditionKey(c))}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="ml-auto rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-300"
                  >
                    {t("collectionRemove")}
                  </button>
                </div>

                {item.notes && <p className="truncate text-xs text-gray-500">{item.notes}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {items.length > 0 && (
        <p className="text-center text-xs text-gray-600">
          {items.length} / {total} {t("collectionUnique")}
        </p>
      )}
    </div>
  );
}
