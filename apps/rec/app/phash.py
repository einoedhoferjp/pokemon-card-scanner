"""Perceptual Hash (pHash, DCT-basiert, 64 Bit) + Hamming-Distanz.

Der Index wird als NumPy-Array (.npz) vorgehalten:
- bits: uint64 [N] (oder uint8 [N,8]) Hashes
- ids:  list[str]  TCGdex-Karten-IDs (parallel zu bits)

Die Kartennummern liegen getrennt als JSON daneben (siehe indexio.py), damit
der Index ohne Pickle gelesen werden kann.
"""

from __future__ import annotations

import cv2
import numpy as np

from .indexio import load_ids, save_ids

HASH_SIZE = 8   # 8x8 -> 64 Bit
LOW_FREQ = 8    # obere linke LOW_FREQ x LOW_FREQ DCT-Koeffizienten nutzen


def phash(image: np.ndarray) -> int:
    """Berechnet den 64-Bit-pHash eines BGR- oder Graustufenbildes."""
    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    # feste Größe (32x32) für DCT-Stabilität
    resized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(resized)
    block = dct[:HASH_SIZE, :HASH_SIZE].flatten()
    # Mittelwert OHNE den DC-Koeffizienten (index 0) – Standard-pHash
    median = np.median(block[1:])
    bits = block > median
    bits[0] = True  # DC wird nicht genutzt (Position 0 bleibt konventionell)
    value = 0
    for i, b in enumerate(bits):
        if b:
            value |= 1 << i
    return int(value)


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


class PhashIndex:
    """In-Memory-Index über alle Referenzbilder."""

    def __init__(self) -> None:
        self.hashes: np.ndarray | None = None  # uint64 [N]
        self.ids: list[str] = []

    def build(self, ids: list[str], hashes: list[int]) -> None:
        self.ids = list(ids)
        self.hashes = np.array(hashes, dtype=np.uint64)

    def save(self, path: str) -> None:
        # Zahlen ins npz, Kartennummern als JSON (kein Pickle, siehe indexio.py).
        np.savez_compressed(path, hashes=self.hashes)
        save_ids(path, self.ids)

    def load(self, path: str) -> None:
        # allow_pickle=False: eine manipulierte Index-Datei kann so keinen Code
        # ausfuehren (CWE-502).
        data = np.load(path, allow_pickle=False)
        self.hashes = data["hashes"].astype(np.uint64)
        self.ids = load_ids(path)

    @property
    def size(self) -> int:
        return len(self.ids)

    def query(self, query_hash: int, top_k: int = 10, max_distance: int = 14) -> list[tuple[str, int]]:
        """Liefert [(card_id, distance), ...] aufsteigend, nur Treffer <= max_distance."""
        if self.hashes is None or self.size == 0:
            return []
        q = np.uint64(query_hash & 0xFFFFFFFFFFFFFFFF)
        xor = np.bitwise_xor(self.hashes, q)
        # Hamming-Distanz über Bitpopulation
        dists = np.fromiter((bin(int(x)).count("1") for x in xor), dtype=np.int32, count=len(xor))
        order = np.argsort(dists, kind="stable")
        out: list[tuple[str, int]] = []
        for idx in order[:top_k]:
            d = int(dists[idx])
            if d > max_distance:
                break
            out.append((self.ids[int(idx)], d))
        return out
