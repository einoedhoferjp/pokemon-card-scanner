import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CardCondition, CardSummary } from "@shared/types";
import { CARD_CONDITIONS } from "@shared/types";
import { addToCollection, apiUrl, getCard, listCollection, ownedQuantity } from "../lib/api";
import { conditionKey, useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";

/** Kartendetail: Referenzbild, Daten und (angemeldet) direkt sammeln. */
export function CardDetailPage() {
  const { t, cardName } = useI18n();
  const { user } = useAuth();
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [card, setCard] = useState<CardSummary | null>(null);
  const [owned, setOwned] = useState(0);
  const [condition, setCondition] = useState<CardCondition>("near_mint");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const c = await getCard(id);
      setCard(c);
      if (user) {
        const ownedMap = await ownedQuantity([c.tcgdexId]);
        setOwned(ownedMap[c.tcgdexId] ?? 0);
        // Vorhandenen Zustand vorbelegen, damit "+1" nicht versehentlich einen
        // zweiten Zustand anlegt.
        const list = await listCollection({ q: c.tcgdexId, limit: 50 });
        const mine = list.items.filter((i) => i.card.tcgdexId === c.tcgdexId);
        if (mine.length > 0) setCondition(mine[0].condition);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      await addToCollection({ cardId: card.tcgdexId, condition });
      setOwned((n) => n + 1);
      setNotice(t("collectionAddedHint"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [card, condition, t]);

  if (error && !card) {
    return (
      <div className="space-y-4 p-6 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        <Link to="/sammlung" className="text-sm text-sky-400 underline">
          {t("collectionTitle")}
        </Link>
      </div>
    );
  }
  if (!card) {
    return <p className="p-6 text-center text-sm text-gray-400">{t("resultLoading")}</p>;
  }

  const img = apiUrl(card.imageUrl);

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-sm text-gray-400 underline"
      >
        ← {t("resultBack")}
      </button>

      {img ? (
        <img
          src={img}
          alt={cardName(card)}
          className="mx-auto w-full max-w-xs rounded-2xl ring-1 ring-gray-700"
        />
      ) : (
        <div className="mx-auto flex aspect-[63/88] w-full max-w-xs items-center justify-center rounded-2xl bg-gray-800 text-xs text-gray-500">
          {t("searchImageMissing")}
        </div>
      )}

      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">{cardName(card)}</h1>
        <p className="text-sm text-gray-400">
          {card.setName ?? card.setId} · {t("cardNumber")} {card.number}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </p>
        <p className="text-xs text-gray-600">{card.tcgdexId}</p>
      </div>

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

      {user ? (
        <div className="space-y-3 rounded-xl border border-gray-800 p-3">
          <p className="text-sm text-gray-300">
            {owned > 0 ? t("collectionOwned").replace("{n}", String(owned)) : t("collectionAdd")}
          </p>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">
              {t("collectionCondition")}
            </span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as CardCondition)}
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
            >
              {CARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {t(conditionKey(c))}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
          >
            {t("collectionAdd")}
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-gray-800 p-3 text-center">
          <p className="text-sm text-gray-400">{t("collectionLoginHint")}</p>
          <Link
            to="/anmelden"
            className="inline-block rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white"
          >
            {t("collectionLoginToAdd")}
          </Link>
        </div>
      )}
    </div>
  );
}
