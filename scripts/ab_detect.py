"""A/B-Vergleich der beiden Detektoren auf die pHash-Retrieval-Genauigkeit.

- legacy: app.card_detect.find_card_quad  (630x880, Adaptive/Otsu/Canny)
- neu:    app.detect.find_card            (693x968, Rohkandidat, evaluiert)

Fuer dieselben simulierten Fotos wird je Detektor der warpte Kartenausschnitt
(+ Fallbacks bei Nicht-Erkennung) berechnet und im pHash-Index gesucht.

Aufruf (aus dem Repo-Root):
    apps/rec/.venv/bin/python scripts/ab_detect.py [--n 120] [--seed 1]
"""

from __future__ import annotations

import argparse
import pathlib
import random
import sys
import time

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "rec"))

from app import card_detect, detect  # noqa: E402
from app.phash import PhashIndex, phash  # noqa: E402
from scripts.eval_phash import simulate_photo  # noqa: E402

REF_DIR = ROOT / "data" / "ref_cache" / "cards"
INDEX_PATH = ROOT / "data" / "index" / "phash.npz"


def warps_legacy(photo: np.ndarray) -> tuple[list[np.ndarray], bool]:
    warped, info = card_detect.detect_and_warp(photo)
    out = [warped]
    if not info["card_detected"]:
        out.extend(card_detect.warp_fallbacks(photo))
    return out, bool(info["card_detected"])


def warps_neu(photo: np.ndarray) -> tuple[list[np.ndarray], bool]:
    det = detect.find_card(photo)
    if det is None:
        return card_detect.warp_fallbacks(photo), False
    return [detect.warp_card(photo, det.corners)], True


def query(idx: PhashIndex, warps: list[np.ndarray]) -> list[tuple[str, int]]:
    best: dict[str, int] = {}
    for w in warps:
        for cid, d in idx.query(phash(w), top_k=5, max_distance=64):
            if cid not in best or d < best[cid]:
                best[cid] = d
    return sorted(best.items(), key=lambda kv: kv[1])


def run(name: str, fn, files, idx: PhashIndex, rng: random.Random) -> tuple[float, float, int]:
    top1 = top3 = det = 0
    t0 = time.time()
    for f in files:
        ref = cv2.imread(str(f))
        if ref is None:
            continue
        photo = simulate_photo(ref, rng)
        warps, found = fn(photo)
        det += int(found)
        res = query(idx, warps)
        ids = [c[0] for c in res[:3]]
        if ids[:1] == [f.stem]:
            top1 += 1
        if f.stem in ids:
            top3 += 1
    n = len(files)
    dt = time.time() - t0
    print(
        f"{name:8s} Top-1 {top1:4d}/{n} ({top1 / n * 100:5.1f}%)  "
        f"Top-3 {top3:4d}/{n} ({top3 / n * 100:5.1f}%)  "
        f"Detektion {det}/{n} ({det / n * 100:4.1f}%)  {dt:.0f}s"
    )
    return top1 / n, top3 / n, det


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=120)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    idx = PhashIndex()
    idx.load(str(INDEX_PATH))
    files = sorted(REF_DIR.glob("*.jpg"))
    sample = random.Random(args.seed).sample(files, min(args.n, len(files)))
    print(f"pHash-Index: {idx.size}, Testbilder: {len(sample)} (seed={args.seed})\n")

    # identische Fotos fuer beide Detektoren: gleiche Seeds wiederverwenden
    seed = 12345
    run("legacy", warps_legacy, sample, idx, random.Random(seed))
    run("neu", warps_neu, sample, idx, random.Random(seed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
