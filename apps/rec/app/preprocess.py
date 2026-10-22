"""Bildqualitätsprüfung vor der Erkennung.

Prüft (alle Werte 0..1, höher = besser):
- sharpness:  Varianz des Laplacian-Operators (auf Skalierung normalisiert)
- brightness: mittlere Helligkeit (zu dunkel/hell wird bestraft)
- glare:      Anteil überbelichteter Pixel in großen Zusammenhängen (Glanzreflex)

`passes()` entscheidet, ob die Erkennung gestartet wird.
"""

from __future__ import annotations

import cv2
import numpy as np

# Schwellwerte (konservativ, für mobile Fotos ausgelegt)
SHARPNESS_MIN = 40.0        # Laplace-Varianz (8bit-Skala) nach Resize auf 640px Breite
BRIGHTNESS_RANGE = (45, 230)  # mittlere Graustufe
GLARE_MAX = 0.10            # max. 10 % stark überbelichtete Pixel


def _to_gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def quality_metrics(image: np.ndarray) -> dict:
    """Berechnet die Qualitätsmetriken eines BGR-Bildes."""
    gray = _to_gray(image)

    # Schärfe auf feste Skala normalisieren (Ergebnis unabhängig von Auflösung)
    h, w = gray.shape
    target_w = 640
    if w != target_w:
        scale = target_w / w
        gray_small = cv2.resize(gray, (target_w, max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    else:
        gray_small = gray

    lap = cv2.Laplacian(gray_small, cv2.CV_64F)
    sharpness = float(lap.var())

    brightness = float(gray.mean())

    # Glanz: fast weiße, zusammenhängende Flächen (nicht die weißen Ränder der Karte)
    _, bright_mask = cv2.threshold(gray, 250, 255, cv2.THRESH_BINARY)
    glare_ratio = float(bright_mask.mean()) / 255.0

    return {
        "sharpness": sharpness,
        "brightness": brightness,
        "glare": glare_ratio,
    }


def passes(metrics: dict) -> tuple[bool, list[str]]:
    """True wenn die Qualität für die Erkennung reicht. Liefert außerdem Hinweise."""
    problems: list[str] = []
    if metrics["sharpness"] < SHARPNESS_MIN:
        problems.append("unscharf")
    lo, hi = BRIGHTNESS_RANGE
    if metrics["brightness"] < lo:
        problems.append("zu dunkel")
    elif metrics["brightness"] > hi:
        problems.append("zu hell")
    if metrics["glare"] > GLARE_MAX:
        problems.append("glanzreflex")
    return (len(problems) == 0, problems)


def quality_check(image: np.ndarray) -> dict:
    metrics = quality_metrics(image)
    ok, problems = passes(metrics)
    return {"metrics": metrics, "ok": ok, "problems": problems}
