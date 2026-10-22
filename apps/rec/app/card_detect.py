"""Kartenerkennung + Perspektivenkorrektur.

Pipeline:
1. Kandidatenkonturen (Adaptive Threshold + Approx-Polygon, 4 Ecken,
   Seitenverhältnis im Rahmen der offiziellen 63x88mm-Karte).
2. Fallback: größtes Rechteck, falls keine Kontur gefunden wird.
3. Perspektivische Korrektur auf ein festes Ziel-Verhältnis (63/88).

Standard-Output: BGR-Bild der Karte, aufrecht, randscharf.
"""

from __future__ import annotations

import cv2
import numpy as np

# Offizielle Kartenmaße (mm) -> Seitenverhältnis Breite/Höhe
CARD_ASPECT = 63.0 / 88.0  # ≈ 0.716
TARGET_W = 630
TARGET_H = 880  # 10 px/mm


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Reihenfolge: oben-links, oben-rechts, unten-rechts, unten-links."""
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def _quad_score(contour: np.ndarray, w: int, h: int) -> tuple[float, np.ndarray] | None:
    """Prüft, ob die Kontur eine Karte ähnelt. Liefert (score, quad) oder None."""
    area = cv2.contourArea(contour)
    if area < 0.02 * w * h:  # mindestens 2 % des Bildes
        return None
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.03 * peri, True)
    if len(approx) != 4 or not cv2.isContourConvex(approx):
        return None

    quad = _order_corners(approx)
    (tl, tr, br, bl) = quad
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    if width == 0 or height == 0:
        return None

    aspect = width / height
    # Seitverhältnis tolerieren (Kamera-Winkel, Beschnitt erlaubt)
    if not (CARD_ASPECT * 0.75 <= aspect <= CARD_ASPECT * 1.35):
        return None

    # Vollflächigkeit: Flächenanteil des Quads relativ zur Bounding-Box
    box_area = width * height
    fill = area / box_area if box_area else 0
    if fill < 0.7:
        return None

    # Score: wie nah am Ideal-Verhältnis
    score = 1.0 - min(1.0, abs(aspect - CARD_ASPECT) / CARD_ASPECT)
    return score, quad


def find_card_quad(image: np.ndarray) -> np.ndarray | None:
    """Sucht die 4 Ecken der Karte im BGR-Bild."""
    h, w = image.shape[:2]
    scale = 800 / max(h, w)
    small = cv2.resize(image, (int(w * scale), int(h * scale))) if scale < 1 else image
    sh, sw = small.shape[:2]

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 7, 50, 50)

    candidates: list[tuple[float, np.ndarray]] = []

    def add_from(contours) -> None:
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:20]:
            r = _quad_score(c, sw, sh)
            if r:
                candidates.append(r)

    # Variante 1: Adaptive Threshold
    for blk in (31, 51, 71):
        th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, blk, 10)
        contours, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        add_from(contours)

    # Variante 2: Otsu
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(otsu, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    add_from(contours)

    # Variante 3: Canny-Kanten
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    add_from(contours)

    if not candidates:
        return None

    candidates.sort(key=lambda t: t[0], reverse=True)
    best_quad = candidates[0][1]

    # zurück auf Originalauflösung
    return (best_quad / np.array([scale, scale], dtype=np.float32)).astype(np.float32)


def warp_card(image: np.ndarray, quad: np.ndarray | None = None) -> np.ndarray:
    """Perspektivische Korrektur auf TARGET_W x TARGET_H."""
    if quad is None:
        quad = find_card_quad(image)
    if quad is None:
        # Fallback: zentraler Ausschnitt im richtigen Verhältnis
        h, w = image.shape[:2]
        if w / h > CARD_ASPECT:
            new_w = int(h * CARD_ASPECT)
            x0 = (w - new_w) // 2
            crop = image[:, x0 : x0 + new_w]
        else:
            new_h = int(w / CARD_ASPECT)
            y0 = (h - new_h) // 2
            crop = image[y0 : y0 + new_h, :]
        return cv2.resize(crop, (TARGET_W, TARGET_H))

    dst = np.array(
        [[0, 0], [TARGET_W - 1, 0], [TARGET_W - 1, TARGET_H - 1], [0, TARGET_H - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(_order_corners(quad), dst)
    return cv2.warpPerspective(image, m, (TARGET_W, TARGET_H), flags=cv2.INTER_LINEAR)


def warp_fallbacks(image: np.ndarray) -> list[np.ndarray]:
    """Mehrere Notausschnitte, wenn keine Kontur gefunden wurde.

    Alle auf TARGET_W x TARGET_H skaliert – die Karte kann an
    verschiedenen Stellen im Bild liegen.
    """
    h, w = image.shape[:2]
    out: list[np.ndarray] = []

    def crop_and_resize(x0: int, y0: int, cw: int, ch: int) -> None:
        if cw <= 0 or ch <= 0:
            return
        x0 = max(0, min(w - cw, x0))
        y0 = max(0, min(h - ch, y0))
        out.append(cv2.resize(image[y0 : y0 + ch, x0 : x0 + cw], (TARGET_W, TARGET_H)))

    # 1) zentral im Karten-Seitenverhältnis
    if w / h > CARD_ASPECT:
        cw = int(h * CARD_ASPECT)
        crop_and_resize((w - cw) // 2, 0, cw, h)
    else:
        ch = int(w / CARD_ASPECT)
        crop_and_resize(0, (h - ch) // 2, w, ch)

    # 2) Gesamtbild gestreckt
    out.append(cv2.resize(image, (TARGET_W, TARGET_H)))

    # 3) obere/untere Bildhälfte (Karte oft in der Mitte, aber nie exakt)
    for frac in (0.15, 0.35):
        ch = int(h * 0.7)
        crop_and_resize(0, int(h * frac), w, ch)

    return out


def detect_and_warp(image: np.ndarray) -> tuple[np.ndarray, dict]:
    """Erkennt die Karte und liefert (warped, info)."""
    quad = find_card_quad(image)
    found = quad is not None
    warped = warp_card(image, quad)
    return warped, {"card_detected": found}


def preview_find(image: np.ndarray) -> np.ndarray:
    """Debug: gezeichnete Kontur (für Tests)."""
    out = image.copy()
    quad = find_card_quad(image)
    if quad is not None:
        cv2.polylines(out, [quad.astype(np.int32)], True, (0, 255, 0), 3)
    return out
