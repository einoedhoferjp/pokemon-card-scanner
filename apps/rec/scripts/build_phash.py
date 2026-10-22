"""pHash-Index über alle Referenzbilder aufbauen.

Aufruf (aus apps/rec):
    python -m scripts.build_phash

Speichert: data/index/phash.npz (parallel zu REF_CACHE_DIR)
"""

from __future__ import annotations

import os
import pathlib
import sys
import time

import cv2

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.phash import PhashIndex, phash  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
REF_DIR = pathlib.Path(os.environ.get("REF_CACHE_DIR", str(REPO_ROOT / "data" / "ref_cache")))
OUT_DIR = pathlib.Path(os.environ.get("INDEX_DIR", str(REPO_ROOT / "data" / "index")))


def main() -> None:
    cards_dir = REF_DIR / "cards"
    files = sorted(cards_dir.glob("*.jpg"))
    if not files:
        print(f"Keine Bilder in {cards_dir}")
        sys.exit(1)

    t0 = time.time()
    ids: list[str] = []
    hashes: list[int] = []
    errors = 0
    for i, f in enumerate(files, 1):
        img = cv2.imread(str(f))
        if img is None:
            errors += 1
            continue
        ids.append(f.stem)
        hashes.append(phash(img))
        if i % 2000 == 0:
            print(f"{i}/{len(files)} ({time.time() - t0:.0f}s)")

    idx = PhashIndex()
    idx.build(ids, hashes)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "phash.npz"
    idx.save(str(out))

    print(f"FERTIG: {idx.size} Hashes, {errors} Fehler, {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
