"""Diagnose: Welches Verfahren traegt, und was bringt die Vereinigung?

Pro simuliertem Foto (gleiche Erzeugung wie evaluate):
- pHash       Top-1 / Top-3
- Embedding   Top-1 / Top-3
- Union       Recall@30 (ist die Wahrheit in pHash-oder-Embedding-Top-30?)
- Union       Top-1 (bestes Einzelverfahren nach Score)

Aufruf (aus apps/rec):
    python -m scripts.eval_methods --samples 200 [--seed 42]
"""

from __future__ import annotations

import argparse
import pathlib
import random
import sys

import cv2

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.card_detect import detect_and_warp  # noqa: E402
from app.pipeline import Recognizer  # noqa: E402
from app.phash import phash  # noqa: E402
from scripts.eval_phash import simulate_photo  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
REF_DIR = REPO_ROOT / "data" / "ref_cache" / "cards"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rec = Recognizer()
    files = sorted(REF_DIR.glob("*.jpg"))
    rng = random.Random(args.seed)
    sample = rng.sample(files, min(args.samples, len(files)))

    n = ph1 = ph3 = e1 = e3 = u30 = 0
    for f in sample:
        ref = cv2.imread(str(f))
        if ref is None:
            continue
        truth = f.stem
        photo = simulate_photo(ref, random.Random(hash((str(f), args.seed)) & 0xFFFFFFFF))
        warped, _ = detect_and_warp(photo)
        n += 1

        ph_ids = [c[0] for c in rec.phash_index.query(phash(warped), top_k=30, max_distance=32)]
        ph1 += ph_ids[:1] == [truth]
        ph3 += truth in ph_ids[:3]

        em_ids: list[str] = []
        if rec.emb_index.size:
            vec = rec.embedder.embed(warped)
            em_ids = [c[0] for c in rec.emb_index.query(vec, top_k=30)]
            e1 += em_ids[:1] == [truth]
            e3 += truth in em_ids[:3]

        u30 += truth in set(ph_ids) | set(em_ids)

    def pct(x: int) -> str:
        return f"{x:4d}/{n} ({x / n * 100:5.1f}%)"

    print("\n" + "=" * 52)
    print(f"METHODEN-DIAGNOSE ({n} Fotos, seed={args.seed})")
    print("=" * 52)
    print(f"pHash      Top-1 {pct(ph1)}  Top-3 {pct(ph3)}")
    if rec.emb_index.size:
        print(f"Embedding  Top-1 {pct(e1)}  Top-3 {pct(e3)}")
    else:
        print("Embedding  Index fehlt")
    print(f"Union      Recall@30 {pct(u30)}  <- Obergrenze fuer Re-Ranking")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
