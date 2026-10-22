"""Embedding-Index über alle Referenzbilder aufbauen (DINOv2-small, ONNX).

Aufruf (aus apps/rec):
    python -m scripts.build_embeddings [--limit N] [--batch 16]

Speichert: data/index/embeddings.npz
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.embeddings import Embedder, EmbeddingIndex  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
REF_DIR = pathlib.Path(os.environ.get("REF_CACHE_DIR", str(REPO_ROOT / "data" / "ref_cache")))
OUT_DIR = pathlib.Path(os.environ.get("INDEX_DIR", str(REPO_ROOT / "data" / "index")))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--out", type=str, default="")
    args = ap.parse_args()

    files = sorted((REF_DIR / "cards").glob("*.jpg"))
    if args.limit:
        files = files[: args.limit]
    if not files:
        print(f"Keine Bilder in {REF_DIR / 'cards'}")
        sys.exit(1)

    embedder = Embedder()
    print(f"Modell geladen, {len(files)} Bilder, batch={args.batch}")

    ids: list[str] = []
    vecs: list[np.ndarray] = []
    errors = 0
    t0 = time.time()

    batch_imgs: list[np.ndarray] = []
    batch_ids: list[str] = []

    def flush() -> None:
        nonlocal batch_imgs, batch_ids
        if not batch_imgs:
            return
        v = embedder.embed_batch(batch_imgs, batch_size=args.batch)
        vecs.extend(list(v))
        ids.extend(batch_ids)
        batch_imgs, batch_ids = [], []

    for i, f in enumerate(files, 1):
        img = cv2.imread(str(f))
        if img is None:
            errors += 1
            continue
        batch_imgs.append(img)
        batch_ids.append(f.stem)
        if len(batch_imgs) >= args.batch:
            flush()
        if i % 1000 == 0:
            flush()
            print(f"{i}/{len(files)} ({time.time() - t0:.0f}s)", flush=True)

    flush()
    idx = EmbeddingIndex()
    idx.build(ids, np.vstack(vecs) if vecs else np.zeros((0, 384), np.float32))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = pathlib.Path(args.out) if args.out else OUT_DIR / "embeddings.npz"
    idx.save(out)
    print(f"FERTIG: {idx.size} Embeddings, {errors} Fehler, {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
