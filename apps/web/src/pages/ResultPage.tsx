import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CardSummary, RecognitionCandidate, Scan } from "@shared/types";
import { addToCollection, apiUrl, getScan, ownedQuantity, sendFeedback } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { StatusBadge } from "../components/StatusBadge";
import { ManualSearch } from "../components/ManualSearch";
import { errorMessage } from "../lib/errors";

export function ResultPage() {
  const { id = "" } = useParams();
  const { t, cardName } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [scan, setScan] = useState<Scan | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  /** Menge der gewählten Karte in der eigenen Sammlung (0 = nicht vorhanden) */
  const [owned, setOwned] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getScan(id);
      setScan(data.scan);
      setCards(data.cards);
      setSelected(data.scan.chosenCardId ?? data.scan.candidates[0]?.cardId ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.tcgdexId, c])), [cards]);
  const selectedCard = selected ? (byId.get(selected) ?? null) : null;
  const top = scan?.candidates[0] ?? null;
  const referenceCard = selectedCard ?? (top ? (byId.get(top.cardId) ?? null) : null);
  const decided =
    scan != null && ["confirmed", "corrected", "rejected", "auto"].includes(scan.status);
  /** Zustand, in dem die Karte in der Sammlung liegen sollte (bestätigt/auto). */
  const collects = scan != null && ["confirmed", "corrected", "auto"].includes(scan.status);

  // "Habe ich schon?" für die gewählte Karte (nur angemeldet).
  useEffect(() => {
    if (!user || !selected) {
      setOwned(0);
      return;
    }
    let cancelled = false;
    void ownedQuantity([selected])
      .then((map) => {
        if (!cancelled) setOwned(map[selected] ?? 0);
      })
      .catch(() => {
        /* egal – die Sammlung ist Beiwerk */
      });
    return () => {
      cancelled = true;
    };
  }, [user, selected]);

  const act = useCallback(
    async (action: "confirm" | "correct" | "reject", cardId?: string) => {
      if (!scan) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await sendFeedback(scan.id, { action, cardId });
        setScan(updated);
        if (updated.chosenCardId) setSelected(updated.chosenCardId);
        setShowSearch(false);
        setNotice(action === "reject" ? null : t("collectionAdded"));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [scan, t],
  );

  /** Gewählte Karte ohne Bestätigung in die Sammlung legen. */
  const addSelected = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await addToCollection({ cardId: selected });
      setOwned((n) => n + 1);
      setNotice(t("collectionAdded"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [selected, t]);

  if (loading) {
    return <p className="p-6 text-center text-sm text-gray-400">{t("resultLoading")}</p>;
  }
  if (error && !scan) {
    return (
      <div className="space-y-4 p-6 text-center">
        <p className="text-sm text-rose-300">{error}</p>
        <Link to="/" className="text-sm text-sky-400 underline">
          {t("resultBack")}
        </Link>
      </div>
    );
  }
  if (!scan) {
    return <p className="p-6 text-center text-sm text-gray-400">{t("resultNotFound")}</p>;
  }

  const photoUrl = apiUrl(scan.imageUrl);
  const refUrl = referenceCard ? apiUrl(referenceCard.imageUrl) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("resultTitle")}</h1>
        <StatusBadge status={scan.status} />
      </div>

      {scan.recognition.autoSave && scan.status === "auto" && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="text-sm font-medium text-emerald-200">{t("resultAuto")}</p>
          <p className="text-xs text-emerald-200/80">{t("resultAutoHint")}</p>
        </div>
      )}
      {scan.status === "pending" && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {t("resultCheck")}
        </p>
      )}
      {["confirmed", "corrected"].includes(scan.status) && (
        <p className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200">
          {t("resultSaved")} – {t("resultSavedHint")}
        </p>
      )}
      {scan.status === "rejected" && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {t("resultRejected")} – {t("resultRejectedHint")}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {/* Sammlung: Karte liegt drin (angemeldet) bzw. Hinweis zum Anmelden */}
      {collects && user && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {t("collectionAdded")}
          {owned > 0
            ? ` · ${t("collectionOwned").replace("{n}", String(owned))}`
            : ` – ${t("collectionAddedHint")}`}
        </p>
      )}
      {collects && !user && (
        <p className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200">
          {t("collectionLoginHint")}{" "}
          <Link to="/anmelden" className="underline">
            {t("navLogin")}
          </Link>
        </p>
      )}
      {notice && !collects && (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      {/* Foto vs. Referenzkarte – bewusst nebeneinander, vor dem Speichern */}
      <div className="grid grid-cols-2 gap-3">
        <figure className="space-y-1">
          <figcaption className="text-xs uppercase tracking-wide text-gray-400">
            {t("resultYourPhoto")}
          </figcaption>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={t("resultYourPhoto")}
              className="w-full rounded-xl object-cover ring-1 ring-gray-700"
            />
          ) : (
            <div className="aspect-[3/4] rounded-xl bg-gray-800" />
          )}
        </figure>
        <figure className="space-y-1">
          <figcaption className="text-xs uppercase tracking-wide text-gray-400">
            {t("resultReference")}
          </figcaption>
          {refUrl ? (
            <img
              src={refUrl}
              alt={t("resultReference")}
              className="w-full rounded-xl object-cover ring-1 ring-gray-700"
            />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center rounded-xl bg-gray-800 text-xs text-gray-500">
              {t("searchImageMissing")}
            </div>
          )}
          {referenceCard && (
            <p className="text-xs text-gray-400">
              {cardName(referenceCard)} · {referenceCard.setName ?? referenceCard.setId}{" "}
              {referenceCard.number}
            </p>
          )}
        </figure>
      </div>

      {/* Kandidaten */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t("resultCandidates")}
        </h2>
        {scan.candidates.length === 0 && (
          <p className="text-sm text-gray-400">{t("resultNoCandidates")}</p>
        )}
        <ul className="space-y-2">
          {scan.candidates.map((c, i) => (
            <CandidateRow
              key={c.cardId}
              candidate={c}
              rank={i + 1}
              card={byId.get(c.cardId)}
              selected={c.cardId === selected}
              onSelect={() => setSelected(c.cardId)}
            />
          ))}
        </ul>
      </section>

      {/* Aktionen */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !selected}
          onClick={() =>
            void act(top && selected === top.cardId ? "confirm" : "correct", selected ?? undefined)
          }
          className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {t("resultConfirm")}
        </button>
        <button
          type="button"
          onClick={() => setShowSearch((v) => !v)}
          className="flex-1 rounded-xl border border-gray-700 px-4 py-3 text-sm text-gray-200"
        >
          {t("resultCorrect")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("reject")}
          className="rounded-xl border border-rose-500/50 px-4 py-3 text-sm text-rose-300 disabled:opacity-40"
        >
          {t("resultReject")}
        </button>
      </div>

      {/* Ohne Bestätigung direkt sammeln (nur angemeldet, noch nicht entschieden) */}
      {user && !collects && selected && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void addSelected()}
          className="w-full rounded-xl border border-emerald-600/60 px-4 py-3 text-sm text-emerald-300 disabled:opacity-40"
        >
          {t("collectionAdd")}
          {owned > 0 ? ` · ${t("collectionOwned").replace("{n}", String(owned))}` : ""}
        </button>
      )}

      {showSearch && (
        <section className="rounded-xl border border-gray-800 p-3">
          <ManualSearch
            autoFocus
            selectedId={selected}
            onSelect={(card) => {
              setSelected(card.tcgdexId);
              if (!byId.has(card.tcgdexId)) setCards((prev) => [...prev, card]);
            }}
          />
          {selectedCard && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("correct", selectedCard.tcgdexId)}
              className="mt-3 w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
            >
              {t("resultChooseThis")}
            </button>
          )}
        </section>
      )}

      <details className="rounded-xl border border-gray-800 p-3 text-sm text-gray-300">
        <summary className="cursor-pointer text-gray-400">{t("resultDetails")}</summary>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-gray-500">{t("resultReason")}</dt>
            <dd className="flex-1">{scan.recognition.reason || "–"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-gray-500">{t("resultOcr")}</dt>
            <dd className="flex-1">
              {scan.recognition.ocrName ?? "–"} / {scan.recognition.ocrNumber ?? "–"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-gray-500">{t("resultQuality")}</dt>
            <dd className="flex-1">
              {scan.recognition.quality?.cardDetected === false ? "Karte nicht erkannt · " : ""}
              {scan.recognition.quality?.problems?.join(", ") || "ok"} ·{" "}
              {scan.recognition.elapsedMs} ms
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-gray-500">Scan-ID</dt>
            <dd className="flex-1 break-all">{scan.id}</dd>
          </div>
        </dl>
      </details>

      <div className="flex justify-center gap-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-200"
        >
          {t("resultBack")}
        </button>
        <Link to="/verlauf" className="px-4 py-2 text-sm text-sky-400 underline">
          {t("navHistory")}
        </Link>
      </div>

      {decided && scan.status !== "auto" && (
        <p className="text-center text-xs text-gray-600">
          {t("resultDetails")}: {scan.candidates.length} Kandidaten · {scan.recognition.elapsedMs}{" "}
          ms
        </p>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  rank,
  card,
  selected,
  onSelect,
}: {
  candidate: RecognitionCandidate;
  rank: number;
  card?: CardSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, cardName } = useI18n();
  const img = apiUrl(card?.imageUrl);
  const pct = Math.round(candidate.final * 100);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
          selected ? "border-sky-500 bg-sky-500/10" : "border-gray-800 hover:bg-gray-800/60"
        }`}
      >
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
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-gray-500">#{rank}</span>
            <span className="truncate text-sm font-medium text-gray-100">
              {card ? cardName(card) : candidate.cardId}
            </span>
          </div>
          <p className="truncate text-xs text-gray-400">
            {candidate.setName ?? candidate.setId} · {t("cardNumber")} {candidate.number}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
            <div
              className={`h-full ${pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-gray-600"}`}
              style={{ width: `${Math.max(pct, 3)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {t("confidence")} {candidate.final.toFixed(2)} · pHash {candidate.phashDist ?? "–"} ·
            Emb {candidate.embSim?.toFixed(2) ?? "–"} · OCR {candidate.ocrNumber?.toFixed(1) ?? "–"}
            /{candidate.ocrName?.toFixed(1) ?? "–"}
          </p>
        </div>
        {selected && <span className="text-xs text-sky-300">{t("resultSelected")}</span>}
      </button>
    </li>
  );
}
