"""Rohsignale fuer die Fusion dumpen (fuer Offline-Gewichtstuning).

Laeuft einmal ueber N simulierte Fotos und speichert pro Foto:
- truth (tcgdex_id), Detektion ok?
- pHash-Treffer (id, dist) bis max_distance=64, top 40
- Embedding-Treffer (id, sim), top 40
- OCR-Name / OCR-Nummer

Ergebnis: data/eval_signals.pkl  (wird von scripts/tune_fusion.py gelesen)

Aufruf (aus apps/rec):
    python -m scripts.dump_signals --samples 200 --seed 42
"""

from __future__ import annotations

import argparse
import pathlib
import pickle
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
OUT = REPO_ROOT / "data" / "eval_signals.pkl"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=str, default=str(OUT))
    args = ap.parse_args()

    rec = Recognizer()
    files = sorted(REF_DIR.glob("*.jpg"))
    rng = random.Random(args.seed)
    sample = rng.sample(files, min(args.samples, len(files)))

    records = []
    for i, f in enumerate(sample, 1):
        ref = cv2.imread(str(f))
        if ref is None:
            continue
        photo = simulate_photo(ref, random.Random(hash((str(f), args.seed)) & 0xFFFFFFFF))
        warped, info = detect_and_warp(photo)
        ph = rec.phash_index.query(phash(warped), top_k=40, max_distance=64)
        emb: list[tuple[str, float]] = []
        if rec.emb_index.size:
            emb = rec.emb_index.query(rec.embedder.embed(warped), top_k=40)
        ocr = rec.ocr.read(warped)
        records.append(
            {
                "truth": f.stem,
                "detected": bool(info["card_detected"]),
                "ph": ph,
                "emb": emb,
                "ocr_name": ocr.name,
                "ocr_number": ocr.number,
            }
        )
        if i % 25 == 0:
            print(f"{i}/{len(sample)}", flush=True)

    with open(args.out, "wb") as fh:
        pickle.dump({"seed": args.seed, "records": records}, fh)
    print(f"FERTIG: {len(records)} Signale -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
