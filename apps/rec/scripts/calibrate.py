"""Schwellwerte aus Daten kalibrieren (statt raten).

Fuer eine Stichprobe simulierter Fotos werden pro Foto berechnet:
- pHash-Distanz zur wahren Karte (positiv) und zum besten Fremdtreffer (negativ)
- Embedding-Cosine zur wahren Karte (positiv) und zum besten Fremdtreffer

Daraus Vorschlaege fuer PHASH_DIST_ZERO, EMB_LOWER, EMB_UPPER.

Aufruf (aus apps/rec):
    python -m scripts.calibrate --samples 150
"""

from __future__ import annotations

import argparse
import pathlib
import random
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.card_detect import detect_and_warp  # noqa: E402
from app.embeddings import Embedder, EmbeddingIndex  # noqa: E402
from app.phash import PhashIndex, phash  # noqa: E402
from scripts.eval_phash import simulate_photo  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INDEX_DIR = REPO_ROOT / "data" / "index"
REF_DIR = REPO_ROOT / "data" / "ref_cache" / "cards"


def pct(a: np.ndarray, *ps: float) -> str:
    return " ".join(f"p{p}={np.percentile(a, p):.3f}" for p in ps)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=150)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    ph = PhashIndex()
    ph.load(str(INDEX_DIR / "phash.npz"))
    emb_idx = EmbeddingIndex()
    emb_path = INDEX_DIR / "embeddings.npz"
    has_emb = emb_path.exists()
    if has_emb:
        emb_idx.load(emb_path)
        embedder = Embedder()
    print(f"Index: pHash={ph.size}, Embeddings={emb_idx.size if has_emb else 'fehlt'}")

    files = sorted(REF_DIR.glob("*.jpg"))
    sample = rng.sample(files, min(args.samples, len(files)))

    pos_dist: list[int] = []
    neg_dist: list[int] = []
    pos_sim: list[float] = []
    neg_sim: list[float] = []

    t0 = time.time()
    for i, f in enumerate(sample, 1):
        ref = cv2.imread(str(f))
        if ref is None:
            continue
        photo = simulate_photo(ref, rng)
        warped, _ = detect_and_warp(photo)

        # pHash
        q = phash(warped)
        hits = ph.query(q, top_k=10, max_distance=64)
        hit_ids = {cid for cid, _ in hits}
        true_hit = next((d for cid, d in hits if cid == f.stem), None)
        if true_hit is not None:
            pos_dist.append(true_hit)
        # bester Fremdtreffer
        imp = [d for cid, d in hits if cid != f.stem]
        if imp:
            neg_dist.append(min(imp))

        # Embedding
        if has_emb:
            v = embedder.embed(warped)
            sims = emb_idx.vecs @ v
            truth_idx = emb_idx.ids.index(f.stem) if f.stem in emb_idx.ids else None
            if truth_idx is not None:
                pos_sim.append(float(sims[truth_idx]))
                others = np.delete(sims, truth_idx)
                neg_sim.append(float(others.max()))
        if i % 50 == 0:
            print(f"{i}/{len(sample)} ({time.time() - t0:.0f}s)")

    print("\n=== pHash-Distanz (0 = identisch) ===")
    if pos_dist:
        p = np.array(pos_dist, float)
        n = np.array(neg_dist, float) if neg_dist else np.array([])
        print(f" wahrer Treffer:      n={len(p)} {pct(p, 50, 90, 95, 99)} max={p.max():.0f}")
        if len(n):
            print(f" bester Fremdtreffer: n={len(n)} {pct(n, 5, 50, 95)} min={n.min():.0f}")
        suggestion = max(8, float(np.percentile(p, 95)))
        print(f" Vorschlag PHASH_DIST_ZERO: {suggestion:.0f} "
              f"(damit faellt der positiven Beitrag bei p95 auf 0)")

    if has_emb and pos_sim:
        print("\n=== Embedding-Cosine (1 = identisch) ===")
        p = np.array(pos_sim, float)
        n = np.array(neg_sim, float)
        print(f" wahrer Treffer:      n={len(p)} {pct(p, 5, 50, 95)} min={p.min():.3f}")
        print(f" bester Fremdtreffer: n={len(n)} {pct(n, 5, 50, 95)} max={n.max():.3f}")
        lower = float(np.percentile(n, 95))
        upper = float(np.percentile(p, 5))
        if upper <= lower:
            # Tails ueberlappen (z.B. durch Detektionsfehler): auf Medianwerte
            # ausweichen, damit echte Treffer hoch und Fremdtreffer niedrig
            # bewertet werden - nicht die p5/p95-Vorschlaege nehmen!
            lower = float(np.percentile(n, 50))
            upper = float(np.percentile(p, 50))
            print(" Hinweis: Tails ueberlappen (p5 wahr < p95 fremd) - Vorschlag nutzt die Mediane.")
        elif upper - lower < 0.05:
            print(" ACHTUNG: Trennschaerfe gering (<0.05)")
        print(f" Vorschlag EMB_LOWER: {lower:.3f} (Fremdtreffer)")
        print(f" Vorschlag EMB_UPPER: {upper:.3f} (wahrer Treffer)")


if __name__ == "__main__":
    main()
