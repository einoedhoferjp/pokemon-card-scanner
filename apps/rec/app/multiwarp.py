"""Mehrere Warp-Kandidaten pro Foto (Union beider Detektoren + Notausschnitte).

Motivation (siehe data/ab_detect.log): Der klassische Detektor
(`card_detect`) gewinnt auf rotationslastigen Fotos, der kantenbasierte
(`detect`) auf perspektivischen. Statt sich fuer einen zu entscheiden, werden
die Kandidaten beider Verfahren gewarpt; die Erkennung (pHash/Embedding)
fuehrt die Treffer zusammen und der Konsens entscheidet. Falsche Kandidaten
erzeugen nur zusaetzliche, schwach bewertete Treffer und senken hoechstens den
Vorsprung - daher nie ein stilles Falsch-Speichern.

`candidate_warps(image)` liefert (warps, info) mit 1..max_warps Bildern.
"""

from __future__ import annotations

import cv2
import numpy as np

from . import card_detect, detect
from .phash import hamming, phash

MAX_WARPS = 4
DEDUP_DIST = 6


def candidate_corners(image: np.ndarray) -> list[np.ndarray]:
    """Ecken-Kandidaten beider Detektoren (klassisch zuerst)."""
    out: list[np.ndarray] = []
    q = card_detect.find_card_quad(image)
    if q is not None:
        out.append(np.asarray(q, dtype=np.float32))
    for d in detect.find_cards(image)[:3]:
        out.append(np.asarray(d.corners, dtype=np.float32))
    return out


def candidate_warps(
    image: np.ndarray, max_warps: int = MAX_WARPS
) -> tuple[list[np.ndarray], dict]:
    corners = candidate_corners(image)
    warps: list[np.ndarray] = [card_detect.warp_card(image, q) for q in corners]

    kept: list[np.ndarray] = []
    hashes: list[int] = []
    for w in warps:
        h = phash(w)
        if all(hamming(h, kh) > DEDUP_DIST for kh in hashes):
            kept.append(w)
            hashes.append(h)
        if len(kept) >= max_warps:
            break

    info = {"detected": bool(corners), "n_corners": len(corners), "n_warps": len(kept)}
    if not kept:
        # Kein Quad gefunden: Notausschnitte (Karte evtl. randfüllend/versetzt)
        kept = list(card_detect.warp_fallbacks(image)[:max_warps])
        info["n_warps"] = len(kept)
    return kept, info


def merge_phash_hits(phash_index, warps: list[np.ndarray], top_k: int = 40,
                     max_distance: int = 32) -> list[tuple[str, int]]:
    """pHash-Treffer ueber alle Warps zusammenfuehren (kleinste Distanz gewinnt)."""
    best: dict[str, int] = {}
    for w in warps:
        for cid, d in phash_index.query(phash(w), top_k=top_k, max_distance=max_distance):
            if cid not in best or d < best[cid]:
                best[cid] = d
    return sorted(best.items(), key=lambda kv: kv[1])[:top_k]


def merge_emb_hits(embedder, emb_index, warps: list[np.ndarray],
                   top_k: int = 40) -> list[tuple[str, float]]:
    """Embedding-Treffer ueber alle Warps zusammenfuehren (groesste Cosine gewinnt)."""
    best: dict[str, float] = {}
    for w in warps:
        vec = embedder.embed(w)
        for cid, s in emb_index.query(vec, top_k=top_k):
            if cid not in best or s > best[cid]:
                best[cid] = s
    return sorted(best.items(), key=lambda kv: -kv[1])[:top_k]
