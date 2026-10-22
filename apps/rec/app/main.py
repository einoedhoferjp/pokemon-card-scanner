"""Erkennungs-Service (FastAPI).

Endpoints:
  GET  /health          -> Status + Index-Zaehler
  POST /recognize       -> Multipart-Upload "image" -> Top-3-Kandidaten + Auto-Entscheidung
"""

from __future__ import annotations

import logging
import time

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .pipeline import Recognizer

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rec")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Recognizer im Hintergrund initialisieren (Modell-Ladung dauert)."""
    import threading

    def _warm() -> None:
        try:
            get_recognizer()
        except Exception:  # noqa: BLE001
            log.exception("Warmup fehlgeschlagen")

    threading.Thread(target=_warm, name="rec-warmup", daemon=True).start()
    yield


MAX_UPLOAD_BYTES = 15 * 1024 * 1024

# Nur JPEG/PNG/WebP (Magic Bytes). Der Inhaltstyp-Header allein ist vom
# Aufrufer frei waehlbar und damit keine Pruefung.
_MAGIC = (
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
)


def _sniff(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    for magic, kind in _MAGIC:
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


app = FastAPI(
    title="PCS Rec Service",
    version="0.1.0",
    lifespan=lifespan,
    # Interner Dienst: keine offene API-Beschreibung noetig.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_recognizer: Recognizer | None = None


def get_recognizer() -> Recognizer:
    global _recognizer
    if _recognizer is None:
        _recognizer = Recognizer()
    return _recognizer


class CandidateOut(BaseModel):
    cardId: str = Field(alias="cardId")
    nameDe: str | None = None
    nameEn: str | None = None
    number: str
    setId: str = Field(alias="setId")
    setName: str | None = Field(default=None, alias="setName")
    final: float
    phashDist: int | None = Field(default=None, alias="phashDist")
    embSim: float | None = Field(default=None, alias="embSim")
    ocrNumber: float | None = Field(default=None, alias="ocrNumber")
    ocrName: float | None = Field(default=None, alias="ocrName")
    hasImage: bool = Field(default=False, alias="hasImage")

    model_config = {"populate_by_name": True}


class RecognizeOut(BaseModel):
    candidates: list[CandidateOut]
    autoSave: bool = Field(alias="autoSave")
    reason: str
    ocrName: str | None = Field(default=None, alias="ocrName")
    ocrNumber: str | None = Field(default=None, alias="ocrNumber")
    quality: dict
    elapsedMs: int = Field(alias="elapsedMs")

    model_config = {"populate_by_name": True}


@app.get("/health")
def health() -> dict:
    r = get_recognizer()
    return {
        "status": "ok",
        "phash": r.phash_index.size,
        "embeddings": r.emb_index.size,
        "cards": r.catalog.size,
    }


@app.post("/recognize", response_model=RecognizeOut)
async def recognize_endpoint(image: UploadFile = File(...)) -> RecognizeOut:
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Nur Bilddateien erlaubt")
    # Gelesen wird mit Limit: ein sehr grosser Upload darf nicht erst den
    # Speicher des Dienstes fuellen, bevor die Groessenpruefung greift.
    data = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Bild zu gross (max 15 MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Leere Datei")
    if _sniff(data) is None:
        raise HTTPException(status_code=415, detail="Kein gueltiges Bild (JPEG/PNG/WebP)")

    t0 = time.time()
    try:
        result = get_recognizer().recognize_bytes(data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    out = RecognizeOut(
        candidates=[
            CandidateOut(
                cardId=cs.card_id,
                nameDe=cs.meta.name_de,
                nameEn=cs.meta.name_en,
                number=cs.meta.number,
                setId=cs.meta.set_id,
                setName=cs.meta.set_name,
                final=round(cs.final, 4),
                phashDist=cs.phash_dist,
                embSim=round(cs.emb_sim, 4) if cs.emb_sim is not None else None,
                ocrNumber=round(cs.ocr_number, 3) if cs.ocr_number is not None and cs.ocr_number >= 0 else None,
                ocrName=round(cs.ocr_name, 3) if cs.ocr_name is not None and cs.ocr_name >= 0 else None,
                hasImage=cs.meta.has_image,
            )
            for cs in result.candidates
        ],
        autoSave=result.auto_save,
        reason=result.reason,
        ocrName=result.ocr_name,
        ocrNumber=result.ocr_number,
        quality=result.quality,
        elapsedMs=int((time.time() - t0) * 1000),
    )
    return out
