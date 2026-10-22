"""Eval-Skript: pHash-Retrieval auf simulierten Scan-Fotos.

Aus Referenzbildern werden "Fotos" erzeugt (Skalierung, Hintergrund,
leichte Rotation/Perspektive, Helligkeit) und dann die volle
Detect->Warp->pHash->Query-Kette ausgeführt.

Aufruf (aus apps/rec):
    python -m scripts.eval_phash [--samples 200]

Ausgabe: Top-1/Top-3-Genauigkeit + Distanz-Verteilung.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import random
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.card_detect import detect_and_warp, warp_fallbacks  # noqa: E402
from app.phash import PhashIndex, hamming, phash  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
REF_DIR = pathlib.Path(os.environ.get("REF_CACHE_DIR", str(REPO_ROOT / "data" / "ref_cache")))
INDEX_PATH = pathlib.Path(os.environ.get("INDEX_DIR", str(REPO_ROOT / "data" / "index"))) / "phash.npz"


def simulate_photo(img: np.ndarray, rng: random.Random) -> np.ndarray:
    """Erzeugt aus einem Referenzbild ein realistisches 'Mobilfotо'."""
    h, w = img.shape[:2]
    # Zielgröße (Karte nimmt ~55-75 % der Höhe ein)
    card_h = rng.randint(int(0.55 * 1000), int(0.75 * 1000))
    scale = card_h / h
    card = cv2.resize(img, (int(w * scale), card_h))

    # leichte Rotation
    angle = rng.uniform(-7, 7)
    M = cv2.getRotationMatrix2D((card.shape[1] / 2, card.shape[0] / 2), angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nW = int(sin * card.shape[0] + cos * card.shape[1])
    nH = int(cos * card.shape[0] + sin * card.shape[1])
    M[0, 2] += (nW - card.shape[1]) / 2
    M[1, 2] += (nH - card.shape[0]) / 2
    card = cv2.warpAffine(card, M, (nW, nH), borderValue=(0, 0, 0))
    mask = cv2.warpAffine(np.full(card.shape[:2], 255, np.uint8), M, (nW, nH))

    # Hintergrund: gestreifter Untergrund / Tisch, wächst mit der Karte
    bg_w = nW + rng.randint(150, 450)
    bg_h = nH + rng.randint(200, 700)
    base = rng.randint(60, 190)
    bg = np.full((bg_h, bg_w, 3), base, np.uint8)
    if rng.random() < 0.5:
        for y in range(0, bg_h, rng.randint(20, 60)):
            v = max(0, min(255, base + rng.randint(-50, 50)))
            bg[y : y + 10, :] = v

    x0 = rng.randint(0, bg_w - nW)
    y0 = rng.randint(0, bg_h - nH)
    roi = bg[y0 : y0 + nH, x0 : x0 + nW]
    m2 = mask > 0
    roi[m2] = card[m2]

    # Helligkeit / Kontrast
    alpha = rng.uniform(0.85, 1.15)
    beta = rng.uniform(-20, 20)
    photo = np.clip(bg.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8)
    return photo


def query_photo(idx: PhashIndex, photo: np.ndarray) -> list[tuple[str, int]]:
    """Detect->Warp->pHash->Query; bei Fehlschlag Multi-Crop-Fallback."""
    warped, info = detect_and_warp(photo)
    candidates: dict[str, int] = {}

    def merge(res: list[tuple[str, int]]) -> None:
        for cid, d in res:
            if cid not in candidates or d < candidates[cid]:
                candidates[cid] = d

    merge(idx.query(phash(warped), top_k=5, max_distance=64))
    if not info["card_detected"]:
        for fb in warp_fallbacks(photo):
            merge(idx.query(phash(fb), top_k=5, max_distance=64))

    ranked = sorted(candidates.items(), key=lambda kv: kv[1])
    return ranked[:3]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    idx = PhashIndex()
    idx.load(str(INDEX_PATH))
    print(f"Index: {idx.size} Einträge")

    files = sorted((REF_DIR / "cards").glob("*.jpg"))
    rng = random.Random(args.seed)
    sample = rng.sample(files, min(args.samples, len(files)))

    top1 = 0
    top3 = 0
    undetected = 0
    dists: list[int] = []
    t0 = time.time()

    for f in sample:
        ref = cv2.imread(str(f))
        if ref is None:
            continue
        truth = f.stem
        photo = simulate_photo(ref, rng)
        _, info = detect_and_warp(photo)
        if not info["card_detected"]:
            undetected += 1
        res = query_photo(idx, photo)
        ids = [r[0] for r in res]
        if truth in ids[:1]:
            top1 += 1
        if truth in ids[:3]:
            top3 += 1
        if res:
            # Distanz zum wahren Treffer (falls vorhanden)
            for cid, d in res:
                if cid == truth:
                    dists.append(d)
                    break
            else:
                dists.append(64)  # Treffer nicht in top3
        else:
            dists.append(64)

    n = len(sample)
    dt = time.time() - t0
    print(f"\n=== pHash-Evaluation ({n} simulierter Fotos, {dt:.1f}s, {dt / n * 1000:.0f} ms/Foto) ===")
    print(f"Karte erkannt (Detektion): {(n - undetected)}/{n} ({(n - undetected) / n * 100:.1f}%)")
    print(f"Top-1: {top1}/{n} ({top1 / n * 100:.1f}%)")
    print(f"Top-3: {top3}/{n} ({top3 / n * 100:.1f}%)")
    if dists:
        arr = np.array(dists)
        print(f"Distanz zum wahren Treffer: Median={np.median(arr):.0f} mean={arr.mean():.1f}")
        print(f"Treffer mit Dist<=6: {(arr <= 6).sum()}/{n}")


if __name__ == "__main__":
    main()
