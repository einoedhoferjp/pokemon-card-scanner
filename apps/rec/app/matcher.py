"""Konsens-Erkennung: Vision (pHash + Embeddings) + OCR werden fusioniert.

Methoden und Rohwerte (alle 0..1, hoeher = besser):
- phash_score:   1 - hamming/64 des warpten Bildes zum Kandidaten-Bild
- emb_score:     Cosine-Aehnlichkeit der DINOv2-Embeddings
- ocr_number:    Kartennummer (OCR) == Kandidatennummer
- ocr_name:      Ahnlichkeit OCR-Name <-> Kandidatenname (de/en)

Fusion (gewichtet, nur vorhandene Methoden zaehlen mit):
    vision = 0.55 * emb + 0.45 * phash      (oder fehlende Quelle = Anteil umverteilen)
    final  = 0.65 * vision + 0.20 * ocr_number + 0.15 * ocr_name

Auto-Uebernahme NUR wenn:
- final >= AUTO_MIN_FINAL (0.85)
- mindestens zwei unabhaengige Methoden stimmen ueberein
- Vorsprung zu Platz 2 >= AUTO_MIN_MARGIN (0.08)
Sonst: Top-3-Kandidaten zur manuellen Bestaetigung.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher

from .catalog import CardMeta

# --- Schwellwerte (per Evaluation kalibrieren) -----------------------------
AUTO_MIN_FINAL = 0.85
AUTO_MIN_MARGIN = 0.08
MIN_VISION_AGREEMENT = 0.50  # zweite Vision-Quelle muss mindestens so gut sein

W_EMB = 0.55
W_PHASH = 0.45
W_VISION = 0.65
W_OCR_NUM = 0.20
W_OCR_NAME = 0.15

# pHash: ab welcher Distanz der Beitrag auf 0 faellt.
# Kalibriert mit scripts/calibrate.py (150 sim. Fotos):
#   wahr  p50=4  p95=8.8 | fremd p50=12 p95=16  -> 16 trennt medianisch
PHASH_DIST_ZERO = 16

# Embedding-Cosine: Kalibrierung (sim <= LOWER -> 0, sim >= UPPER -> 1).
# Verteilung: wahr p5=0.699 p50=0.908 | fremd p50=0.742 p95=0.868
# (p5/p95 ueberlappen durch Detektionsfehler - deshalb medianische Wahl;
#  fremder Median ~0.74 faellt damit auf ~0.1, wahrer Median ~0.91 auf ~0.95)
EMB_LOWER = 0.72
EMB_UPPER = 0.92


def phash_score(dist: int) -> float:
    return max(0.0, 1.0 - dist / PHASH_DIST_ZERO)


def emb_score(sim: float) -> float:
    return max(0.0, min(1.0, (sim - EMB_LOWER) / (EMB_UPPER - EMB_LOWER)))


def _norm_name(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def name_similarity(a: str, b: str) -> float:
    """Aehnlichkeit zweier Kartennamen (Toleranz gegen OCR-Rauschen)."""
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    base = SequenceMatcher(None, na, nb).ratio()
    # Teilstring-Bonus (OCR liest "Genesect" von "Genesect V")
    if na in nb or nb in na:
        base = max(base, 0.5 + 0.5 * min(len(na), len(nb)) / max(len(na), len(nb)))
    return base


def number_match(ocr_number: str | None, card_number: str) -> float:
    """1 = exakt, 0.5 = Teilstring (Promo-IDs), 0 = sonst / OCR fehlt nicht."""
    if ocr_number is None:
        return -1.0  # "unbekannt" -> geht nicht in die Fusion ein
    a = ocr_number.lstrip("0") or "0"
    b = card_number.lstrip("0") or "0"
    if a == b:
        return 1.0
    if a and b and (a in b or b in a):
        return 0.6
    return 0.0


def best_name_score(ocr_name: str | None, card: CardMeta) -> float:
    if ocr_name is None:
        return -1.0
    scores = [name_similarity(ocr_name, n) for n in card.names]
    return max(scores) if scores else -1.0


@dataclass
class CandidateScore:
    card_id: str
    meta: CardMeta
    phash_dist: int | None = None
    emb_sim: float | None = None
    ocr_number: float | None = None   # None = OCR-Zahl unbekannt
    ocr_name: float | None = None
    final: float = 0.0
    parts: dict[str, float] = field(default_factory=dict)


@dataclass
class RecognizeResult:
    candidates: list[CandidateScore]
    auto_save: bool
    reason: str
    ocr_name: str | None
    ocr_number: str | None
    ocr_total: str | None
    quality: dict


def fuse(cs: CandidateScore) -> float:
    """Gewichtete Fusion ueber die verfuegbaren Methoden."""
    parts: dict[str, float] = {}

    vision_vals: list[tuple[float, float]] = []
    if cs.emb_sim is not None:
        vision_vals.append((W_EMB, emb_score(cs.emb_sim)))
    if cs.phash_dist is not None:
        vision_vals.append((W_PHASH, phash_score(cs.phash_dist)))
    vision = sum(w * v for w, v in vision_vals) / sum(w for w, _ in vision_vals) if vision_vals else 0.0
    parts["vision"] = vision

    weighted = W_VISION * vision
    total_w = W_VISION

    if cs.ocr_number is not None and cs.ocr_number >= 0:
        weighted += W_OCR_NUM * cs.ocr_number
        total_w += W_OCR_NUM
        parts["ocr_number"] = cs.ocr_number
    if cs.ocr_name is not None and cs.ocr_name >= 0:
        weighted += W_OCR_NAME * cs.ocr_name
        total_w += W_OCR_NAME
        parts["ocr_name"] = cs.ocr_name

    final = weighted / total_w if total_w else 0.0
    cs.final = final
    cs.parts = parts
    return final


def decide(candidates: list[CandidateScore]) -> tuple[bool, str]:
    if not candidates:
        return False, "keine Kandidaten"
    top = candidates[0]
    if len(candidates) == 1:
        margin = 1.0
    else:
        margin = top.final - candidates[1].final

    # OCR-Veto: wenn die OCR ausdruecklich widerspricht, darf KEIN
    # Auto-Schalten erfolgen - auch nicht bei starker Vision.
    # "Nie stillschweigend falsch speichern."
    if top.ocr_number is not None and top.ocr_number >= 0 and top.ocr_number < 0.5:
        return False, f"OCR-Nummer widerspricht (ocr_number={top.ocr_number:.2f})"
    if (
        top.ocr_name is not None
        and top.ocr_name >= 0
        and top.ocr_name < 0.30
        and (top.ocr_number is None or top.ocr_number < 0)
    ):
        # Nur Name als OCR-Evidence vorhanden, und der widerspricht
        return False, f"OCR-Name widerspricht (ocr_name={top.ocr_name:.2f})"

    # Methode 1: OCR bestaetigt (Nummer + Name)
    ocr_ok = (
        top.ocr_number is not None
        and top.ocr_number >= 0.99
        and top.ocr_name is not None
        and top.ocr_name >= 0.75
    )
    # Methode 2: beide Vision-Quellen einig (pHash-Treffer + Embedding-Treffer)
    ph_ok = top.phash_dist is not None and top.phash_dist <= 8
    emb_ok = top.emb_sim is not None and emb_score(top.emb_sim) >= MIN_VISION_AGREEMENT
    vision_ok = ph_ok and emb_ok

    if top.final >= AUTO_MIN_FINAL and margin >= AUTO_MIN_MARGIN:
        if ocr_ok:
            return True, f"Konsens: OCR bestaetigt (final={top.final:.2f}, margin={margin:.2f})"
        if vision_ok:
            return True, f"Konsens: pHash+Embedding einig (final={top.final:.2f}, margin={margin:.2f})"
        return False, f"Score hoch, aber nur eine Methode bestaetigt (final={top.final:.2f})"
    if top.final < AUTO_MIN_FINAL:
        return False, f"Score zu niedrig (final={top.final:.2f} < {AUTO_MIN_FINAL})"
    return False, f"Zu geringer Vorsprung (margin={margin:.2f} < {AUTO_MIN_MARGIN})"


def recognize(
    phash_hits: list[tuple[str, int]],
    emb_hits: list[tuple[str, float]],
    catalog_hits: dict[str, CardMeta],
    ocr_name: str | None,
    ocr_number: str | None,
    quality: dict,
    pool_size: int = 30,
) -> RecognizeResult:
    """Fusioniert alle Quellen zu sortierten Kandidaten + Auto-Entscheidung."""
    pool: dict[str, CandidateScore] = {}

    # pHash-Kandidaten (Distanz -> Score-Komponente)
    for card_id, dist in phash_hits[:pool_size]:
        meta = catalog_hits.get(card_id)
        if meta is None:
            continue
        pool[card_id] = CandidateScore(card_id=card_id, meta=meta, phash_dist=dist)

    # Embedding-Kandidaten ergaenzen/zusammenfuehren
    for card_id, sim in emb_hits[:pool_size]:
        meta = catalog_hits.get(card_id)
        if meta is None:
            continue
        if card_id in pool:
            pool[card_id].emb_sim = sim
        else:
            pool[card_id] = CandidateScore(card_id=card_id, meta=meta, emb_sim=sim)

    # OCR-Pruefung auf dem Pool
    for cs in pool.values():
        cs.ocr_number = number_match(ocr_number, cs.meta.number)
        cs.ocr_name = best_name_score(ocr_name, cs.meta)
        fuse(cs)

    candidates = sorted(pool.values(), key=lambda c: -c.final)
    # OCR-Neutralwerte (-1) nicht als echten Nullpunkt werten: Kandidaten mit
    # unbekannter OCR bleiben drueber, wenn die Vision stark ist.
    auto, reason = decide(candidates)
    top = candidates[0] if candidates else None
    return RecognizeResult(
        candidates=candidates[:3],
        auto_save=auto,
        reason=reason,
        ocr_name=ocr_name,
        ocr_number=ocr_number,
        ocr_total=None,
        quality=quality,
    )
