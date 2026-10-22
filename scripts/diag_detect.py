"""Diagnose: Warum scheitert app.detect auf der simulate_photo-Verteilung?

Vergleicht pro Foto den pHash-Abstand zum Wahren Eintrag fuer
- legacy Warp (app.card_detect) und
- neuen Warp (app.detect.find_card).

Aufruf: apps/rec/.venv/bin/python scripts/diag_detect.py [--n 15]
"""

from __future__ import annotations

import argparse
import pathlib
import random
import sys

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "rec"))

from app import card_detect, detect  # noqa: E402
from app.phash import PhashIndex, hamming, phash  # noqa: E402
from scripts.eval_phash import simulate_photo  # noqa: E402

REF_DIR = ROOT / "data" / "ref_cache" / "cards"
INDEX_PATH = ROOT / "data" / "index" / "phash.npz"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=15)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    idx = PhashIndex()
    idx.load(str(INDEX_PATH))
    pos = {cid: i for i, cid in enumerate(idx.ids)}
    files = sorted(REF_DIR.glob("*.jpg"))
    sample = random.Random(args.seed).sample(files, min(args.n, len(files)))

    rng = random.Random(12345)
    print(f"{'Karte':18s} {'legacy':>8s} {'neu':>8s} {'area':>6s}  neuer Warp-Shape")
    for f in sample:
        ref = cv2.imread(str(f))
        if ref is None:
            continue
        truth = f.stem
        t_hash = int(idx.hashes[pos[truth]])
        photo = simulate_photo(ref, rng)

        w_legacy, _ = card_detect.detect_and_warp(photo)
        d_legacy = hamming(phash(w_legacy), t_hash)

        det = detect.find_card(photo)
        if det is None:
            print(f"{truth:18s} {d_legacy:8d} {'MISS':>8s}")
            continue
        w_new = detect.warp_card(photo, det.corners)
        d_new = hamming(phash(w_new), t_hash)
        print(
            f"{truth:18s} {d_legacy:8d} {d_new:8d} {det.area_ratio:6.2f}  {w_new.shape}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
