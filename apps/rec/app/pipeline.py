"""Erkennungs-Pipeline: Bild -> Quality -> Detect -> pHash -> Embedding -> OCR -> Konsens."""

from __future__ import annotations

import logging
import os
import pathlib
import threading

import cv2
import numpy as np

from .card_detect import detect_and_warp, warp_fallbacks
from .catalog import Catalog, get_catalog
from .embeddings import Embedder, EmbeddingIndex
from .matcher import RecognizeResult, recognize
from .ocr import CardOCR
from .phash import PhashIndex, phash
from .preprocess import quality_check

log = logging.getLogger("rec")

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INDEX_DIR = pathlib.Path(os.environ.get("INDEX_DIR", str(REPO_ROOT / "data" / "index")))


class Recognizer:
    _instance: "Recognizer | None" = None
    _lock = threading.Lock()

    def __new__(cls) -> "Recognizer":
        with cls._lock:
            if cls._instance is None:
                instance = super().__new__(cls)
                try:
                    instance._init()
                except Exception:
                    # Halbfertiges Objekt nicht zwischenspeichern: sonst bleibt
                    # der Dienst nach einem Startfehler (z. B. DB noch nicht
                    # bereit) dauerhaft kaputt, statt beim naechsten Aufruf
                    # erneut zu starten.
                    cls._instance = None
                    raise
                cls._instance = instance
        return cls._instance

    def _init(self) -> None:
        t0 = __import__("time").time()
        self.phash_index = PhashIndex()
        self.phash_index.load(str(INDEX_DIR / "phash.npz"))
        log.info("pHash-Index: %d Eintraege", self.phash_index.size)

        self.catalog: Catalog = get_catalog()
        log.info("Katalog: %d Karten", self.catalog.size)

        emb_path = INDEX_DIR / "embeddings.npz"
        self.emb_index = EmbeddingIndex()
        if emb_path.exists():
            self.emb_index.load(emb_path)
            log.info("Embedding-Index: %d Eintraege", self.emb_index.size)
        else:
            log.warning("Embedding-Index fehlt (%s) - pHash-only", emb_path)

        self.embedder = Embedder()
        self.ocr = CardOCR()
        log.info("Recognizer bereit (%.1fs)", __import__("time").time() - t0)

    def recognize_bytes(self, data: bytes) -> RecognizeResult:
        arr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Bild konnte nicht dekodiert werden")
        return self.recognize(img)

    def recognize(self, image: np.ndarray, use_fallback: bool = False) -> RecognizeResult:
        # 1) Qualitaet
        quality = quality_check(image)

        # 2) Detektion + Perspektivenkorrektur
        warped, det_info = detect_and_warp(image)
        quality["card_detected"] = det_info["card_detected"]

        # 3) Vision-Quellen. Ohne erkannte Kontur koennen zusaetzlich mehrere
        #    Notausschnitte probieren (use_fallback=True); A/B-Evaluation
        #    (300 sim. Fotos) zeigte dabei KEINE Genauigkeitsaenderung, deshalb
        #    default aus - der zentrale Ausschnitt (warp_card-Fallback) reicht.
        query_imgs = [warped]
        if not det_info["card_detected"] and use_fallback:
            query_imgs.extend(warp_fallbacks(image))

        ph_best: dict[str, int] = {}
        emb_best: dict[str, float] = {}
        for i, qimg in enumerate(query_imgs):
            dist_hits = self.phash_index.query(phash(qimg), top_k=30, max_distance=32)
            for cid, d in dist_hits:
                if cid not in ph_best or d < ph_best[cid]:
                    ph_best[cid] = d
            if self.emb_index.size > 0:
                # Embeddings nur für den Haupt-Warp + erste Fallbacks (Latenz)
                if i == 0 or (not det_info["card_detected"] and i <= 2):
                    vec = self.embedder.embed(qimg)
                    for cid, sim in self.emb_index.query(vec, top_k=30):
                        if cid not in emb_best or sim > emb_best[cid]:
                            emb_best[cid] = sim

        phash_hits = sorted(ph_best.items(), key=lambda kv: kv[1])
        emb_hits = sorted(emb_best.items(), key=lambda kv: -kv[1])

        # 4) OCR (Name + Nummer)
        ocr_res = self.ocr.read(warped)

        # 5) Konsens-Fusion
        catalog_hits = {
            cid: m
            for cid in {c[0] for c in phash_hits} | {c[0] for c in emb_hits}
            if (m := self.catalog.get(cid)) is not None
        }
        return recognize(
            phash_hits=phash_hits,
            emb_hits=emb_hits,
            catalog_hits=catalog_hits,
            ocr_name=ocr_res.name,
            ocr_number=ocr_res.number,
            quality=quality,
        )
