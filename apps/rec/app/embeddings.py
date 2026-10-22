"""Bild-Embeddings über DINOv2-small (ONNX, CPU).

- Input: 224x224 RGB, ImageNet-normalisiert
- Output: 384-dim CLS-Token, L2-normalisiert (Cosine = Dot-Produkt)

Der Index wird als .npz gespeichert:
- vecs: float32 [N, 384]
- ids:  list[str]

Die Kartennummern liegen getrennt als JSON daneben (siehe indexio.py), damit
der Index ohne Pickle gelesen werden kann.
"""

from __future__ import annotations

import os
import pathlib

import cv2
import numpy as np
import onnxruntime as ort

from .indexio import load_ids, save_ids

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
DEFAULT_MODEL = REPO_ROOT / "apps" / "rec" / "models" / "dinov2-small.onnx"

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
INPUT_SIZE = 224


def preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """BGR-Bild -> [1,3,224,224] float32 (normalisiert)."""
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    x = resized.astype(np.float32) / 255.0
    x = (x - MEAN) / STD
    return np.transpose(x, (2, 0, 1))[None]


def preprocess_batch(images: list[np.ndarray]) -> np.ndarray:
    return np.concatenate([preprocess(im) for im in images], axis=0)


class Embedder:
    def __init__(self, model_path: str | pathlib.Path | None = None) -> None:
        path = pathlib.Path(model_path or os.environ.get("DINOV2_MODEL", DEFAULT_MODEL))
        self.session = ort.InferenceSession(
            str(path), providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        self.dim = 384

    def embed_batch(self, images: list[np.ndarray], batch_size: int = 16) -> np.ndarray:
        outs: list[np.ndarray] = []
        for i in range(0, len(images), batch_size):
            chunk = images[i : i + batch_size]
            x = preprocess_batch(chunk)
            y = self.session.run(None, {self.input_name: x})[0]  # [B, 257, 384]
            cls = y[:, 0, :]  # CLS-Token
            norms = np.linalg.norm(cls, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            outs.append((cls / norms).astype(np.float32))
        return np.concatenate(outs, axis=0) if outs else np.zeros((0, self.dim), np.float32)

    def embed(self, image_bgr: np.ndarray) -> np.ndarray:
        return self.embed_batch([image_bgr])[0]


class EmbeddingIndex:
    def __init__(self) -> None:
        self.vecs: np.ndarray | None = None  # float32 [N, D], l2-normalisiert
        self.ids: list[str] = []

    def build(self, ids: list[str], vecs: np.ndarray) -> None:
        self.ids = list(ids)
        self.vecs = vecs.astype(np.float32)

    def save(self, path: str | pathlib.Path) -> None:
        # Zahlen ins npz, Kartennummern als JSON (kein Pickle, siehe indexio.py).
        np.savez_compressed(path, vecs=self.vecs)
        save_ids(path, self.ids)

    def load(self, path: str | pathlib.Path) -> None:
        # allow_pickle=False: eine manipulierte Index-Datei kann so keinen Code
        # ausfuehren (CWE-502).
        data = np.load(path, allow_pickle=False)
        self.vecs = data["vecs"].astype(np.float32)
        self.ids = load_ids(path)

    @property
    def size(self) -> int:
        return len(self.ids)

    def query(self, vec: np.ndarray, top_k: int = 10) -> list[tuple[str, float]]:
        """Cosine-Ähnlichkeit (Vektoren sind l2-normalisiert)."""
        if self.vecs is None or self.size == 0:
            return []
        sims = self.vecs @ vec.astype(np.float32)
        order = np.argsort(-sims)[:top_k]
        return [(self.ids[int(i)], float(sims[int(i)])) for i in order]
