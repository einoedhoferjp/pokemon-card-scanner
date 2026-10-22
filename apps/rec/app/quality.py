"""Bildqualitäts-Check vor der Kartenerkennung.

Prüft Schärfe (Laplace-Varianz), Helligkeit und Glanzreflexionen.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import cv2
import numpy as np

from . import config


@dataclass
class QualityReport:
    ok: bool
    sharpness: float
    brightness: float
    glare_ratio: float
    reasons: list[str]

    def dict(self) -> dict:
        return asdict(self)


def _sharpness(gray: np.ndarray) -> float:
    """Laplace-Varianz auf int32 – unabhängig von der Grauwert-Skala."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _brightness(gray: np.ndarray) -> float:
    return float(gray.mean())


def _glare_ratio(card_crop: np.ndarray) -> float:
    """Anteil stark gesättigter (weißer) Pixel – typisch für Spiegelungen."""
    if card_crop.size == 0:
        return 1.0
    gray = cv2.cvtColor(card_crop, cv2.COLOR_BGR2GRAY) if card_crop.ndim == 3 else card_crop
    # Glanz: sehr helle, aber strukturarme Flächen
    blown = float((gray >= 250).mean())
    return blown


def evaluate(image: np.ndarray, card_crop: np.ndarray | None = None) -> QualityReport:
    """Prüft ein BGR-Bild. `card_crop` ist der bereits erkannte Karten-Ausschnitt,
    falls vorhanden – dann werden die Messwerte nur auf der Kartenfläche gemacht."""
    if image is None or image.size == 0:
        return QualityReport(False, 0.0, 0.0, 1.0, ["empty_image"])

    region = card_crop if card_crop is not None and card_crop.size else image
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if region.ndim == 3 else region

    # Downscale für stabile Messwerte bei sehr großen Bildern
    if gray.shape[0] > 1200:
        scale = 1200 / gray.shape[0]
        gray_small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    else:
        gray_small = gray

    sharpness = _sharpness(gray_small)
    brightness = _brightness(gray_small)
    glare = _glare_ratio(region)

    reasons: list[str] = []
    if sharpness < config.QUALITY_MIN_SHARPNESS:
        reasons.append("blurry")
    if brightness < config.QUALITY_MIN_BRIGHTNESS:
        reasons.append("too_dark")
    elif brightness > config.QUALITY_MAX_BRIGHTNESS:
        reasons.append("too_bright")
    if glare > config.QUALITY_MIN_GLARE_RATIO and glare > 0.02:
        reasons.append("glare")

    return QualityReport(
        ok=not reasons,
        sharpness=round(sharpness, 2),
        brightness=round(brightness, 2),
        glare_ratio=round(glare, 4),
        reasons=reasons,
    )
