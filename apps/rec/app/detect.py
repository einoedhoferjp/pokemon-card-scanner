"""Kartenerkennung im Bild + Perspektivenkorrektur.

Sucht nach einem Viereck mit dem Seitenverhältnis 63 x 88 mm, verfeinert die
Ecken linienbasiert an der echten Kartenkante (Gradient-Snap) und warpt die
Karte auf eine Frontalansicht.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import config

CARD_RATIO = config.CARD_MM[0] / config.CARD_MM[1]  # 0.7159 (Breite/Höhe)
TARGET_W = int(round(config.CARD_MM[0] * config.WARP_PX_PER_MM))  # 693
TARGET_H = int(round(config.CARD_MM[1] * config.WARP_PX_PER_MM))  # 968


@dataclass
class Detection:
    corners: np.ndarray  # (4,2) im Originalbild, Reihenfolge o-l, o-r, u-r, u-l
    score: float
    area_ratio: float

    def dict(self) -> dict:
        return {
            "corners": [[round(float(x), 2), round(float(y), 2)] for x, y in self.corners],
            "score": round(self.score, 4),
            "area_ratio": round(self.area_ratio, 4),
        }


def order_points(pts: np.ndarray) -> np.ndarray:
    """Reihenfolge: oben-links, oben-rechts, unten-rechts, unten-links."""
    pts = np.asarray(pts, dtype="float32").reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [
            pts[np.argmin(s)],  # oben-links  (kleinste Summe)
            pts[np.argmin(d)],  # oben-rechts (größte Differenz y-x)
            pts[np.argmax(s)],  # unten-rechts
            pts[np.argmax(d)],  # unten-links
        ],
        dtype="float32",
    )


def _target_corners() -> np.ndarray:
    return np.array(
        [
            [0, 0],
            [TARGET_W - 1, 0],
            [TARGET_W - 1, TARGET_H - 1],
            [0, TARGET_H - 1],
        ],
        dtype="float32",
    )


def warp_card(image: np.ndarray, corners: np.ndarray) -> np.ndarray:
    src = order_points(corners)
    M = cv2.getPerspectiveTransform(src, _target_corners())
    return cv2.warpPerspective(
        image,
        M,
        (TARGET_W, TARGET_H),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REPLICATE,
    )


def quad_from_contour_extremes(
    cnt: np.ndarray, seed: np.ndarray, max_grow: float = 0.15
) -> np.ndarray:
    """Verworfen (Evaluation: 11/40 statt 31/40) – das Einpassen eines
    achsenparallelen Rechtecks im lokalen Rahmen zerstört die Perspektive.
    Bleibt als dokumentierter Fehlversuch im Code."""
    seed = order_points(seed)
    center = seed.mean(axis=0)
    d = seed[1] - seed[0]
    ang = np.arctan2(d[1], d[0])
    ca, sa = np.cos(-ang), np.sin(-ang)
    R = np.array([[ca, -sa], [sa, ca]], dtype=np.float32)  # Bild → lokal

    pts = (cnt.reshape(-1, 2).astype(np.float32) - center) @ R.T
    x0, x1 = np.percentile(pts[:, 0], [0.3, 99.7])
    y0, y1 = np.percentile(pts[:, 1], [0.3, 99.7])

    w_vec, h_vec = seed[1] - seed[0], seed[3] - seed[0]
    half_w = float(np.linalg.norm(w_vec)) / 2.0
    half_h = float(np.linalg.norm(h_vec)) / 2.0
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    x0, x1 = cx + np.clip([x0 - cx, x1 - cx], -half_w * (1 + max_grow), half_w * (1 + max_grow))
    y0, y1 = cy + np.clip([y0 - cy, y1 - cy], -half_h * (1 + max_grow), half_h * (1 + max_grow))

    local = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)
    return order_points((local @ R + center).astype(np.float32))


# ------------------------------------------- Rand-Snap im Warp-Raum

_SNAP_W = 300  # normales Warp-Raster für den Rand-Snap
_SNAP_H = int(round(_SNAP_W / CARD_RATIO))
_SNAP_EXPAND = 1.30  # Quad vor dem Warp vergrößern, damit die echte Kante sicher im Bild liegt
_SNAP_SCAN_MAX = 0.30  # Kante in [0.3 %, 30 %] der Dimension suchen
_SNAP_BAND = 0.03  # Bandbreite innen/außen
_SNAP_MIN_SCORE = 1.0  # schwächere Kanten werden nicht verschoben
TRACE_SNAP = False  # Diagnose: Messwerte des Rand-Snaps mitschreiben
snap_trace: list[dict] = []


def _apply_h(H: np.ndarray, pt: np.ndarray) -> np.ndarray:
    v = H @ np.array([pt[0], pt[1], 1.0])
    return v[:2] / v[2]


def _snap_profile(crop: np.ndarray, axis: int, reverse: bool) -> tuple[np.ndarray, np.ndarray]:
    """Kontrastprofil einer Seite im normalisierten Warp.

    axis=0 → senkrechte Kante (x), axis=1 → waagerechte Kante (y).
    reverse=True: Kante an der rechten/unteren Seite – die Position wird dann
    als Abstand von dieser Seite gemessen.
    Liefert (Positionen, Scores); ungültige Positionen haben Score -inf.
    """
    h, w = crop.shape[:2]
    channels = crop.shape[2] if crop.ndim == 3 else 1
    band = _SNAP_BAND
    gap = _SNAP_BAND * 0.3
    positions = np.arange(0.003, _SNAP_SCAN_MAX, 0.002)
    scores = np.full(len(positions), -np.inf, dtype=np.float64)

    for k, pos in enumerate(positions):
        if pos - gap - band < 0:
            continue
        if reverse:
            in_a, in_b = 1.0 - (pos + gap + band), 1.0 - (pos + gap)
            out_a, out_b = 1.0 - (pos - gap), 1.0 - (pos - gap - band)
        else:
            in_a, in_b = pos + gap, pos + gap + band
            out_a, out_b = pos - gap - band, pos - gap

        if axis == 0:
            i0, i1 = int(in_a * w), max(int(in_b * w), int(in_a * w) + 2)
            o0, o1 = int(out_a * w), max(int(out_b * w), int(out_a * w) + 2)
            inside = crop[:, i0:i1].reshape(-1, channels)
            outside = crop[:, o0:o1].reshape(-1, channels)
        else:
            i0, i1 = int(in_a * h), max(int(in_b * h), int(in_a * h) + 2)
            o0, o1 = int(out_a * h), max(int(out_b * h), int(out_a * h) + 2)
            inside = crop[i0:i1, :].reshape(-1, channels)
            outside = crop[o0:o1, :].reshape(-1, channels)
        if inside.size == 0 or outside.size == 0:
            continue
        inside = inside.astype(np.float32)
        outside = outside.astype(np.float32)
        step = float(np.linalg.norm(inside.mean(axis=0) - outside.mean(axis=0)))
        stds = float(inside.std(axis=0).mean() + outside.std(axis=0).mean())
        scores[k] = step / (stds + 20.0)
    return positions, scores


def _pick_edge(positions: np.ndarray, scores: np.ndarray, base: float) -> tuple[float, float]:
    """Wählt die Kantenposition: nahe der Candidate-Lage, nur bei klar
    besserem Kontrast als genau dort."""
    base_i = int(np.argmin(np.abs(positions - base)))
    base_score = float(scores[base_i]) if np.isfinite(scores[base_i]) else -np.inf
    if not np.isfinite(scores).any():
        return base, base_score

    # Abstandsstrafe: jenseits von ±1 % der Dimension wird es teuer
    penalty = 0.6 * np.maximum(0.0, np.abs(positions - base) - 0.01) / 0.05
    cand = np.where(np.isfinite(scores), scores - penalty, -np.inf)
    i = int(np.argmax(cand))
    if not np.isfinite(cand[i]):
        return base, base_score
    if scores[i] < _SNAP_MIN_SCORE or scores[i] < base_score * 1.20:
        return base, base_score
    return float(positions[i]), float(scores[i])


def snap_borders(image: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Verfeinert die Quad-Kanten: im normalisierten Warp wird pro Seite die
    echte Kartenkante als Kontrastschritt (Hintergrund ↔ Kartenrand) gesucht."""
    quad = order_points(quad)
    center = quad.mean(axis=0)
    big = ((quad - center) * _SNAP_EXPAND + center).astype(np.float32)

    M = cv2.getPerspectiveTransform(
        big, np.array([[0, 0], [_SNAP_W - 1, 0], [_SNAP_W - 1, _SNAP_H - 1], [0, _SNAP_H - 1]], np.float32)
    )
    M_inv = np.linalg.inv(M)
    # BORDER_REPLICATE: andernfalls entstehen außerhalb des Bildes schwarze
    # Flächen, die wie eine echte Kante aussehen und den Snap verfälschen.
    crop = cv2.warpPerspective(
        image, M, (_SNAP_W, _SNAP_H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE
    )

    base = (1.0 - 1.0 / _SNAP_EXPAND) / 2.0  # Candidate-Rand liegt so tief im Warp
    pos_l, sc_l = _pick_edge(*_snap_profile(crop, 0, False), base)
    pos_r, sc_r = _pick_edge(*_snap_profile(crop, 0, True), base)
    pos_t, sc_t = _pick_edge(*_snap_profile(crop, 1, False), base)
    pos_b, sc_b = _pick_edge(*_snap_profile(crop, 1, True), base)

    if TRACE_SNAP:
        snap_trace.append(
            {
                "pos": (pos_l, pos_r, pos_t, pos_b),
                "score": (sc_l, sc_r, sc_t, sc_b),
                "base": base,
                "quad": quad.copy(),
            }
        )

    def line_left() -> tuple[np.ndarray, np.ndarray]:
        a = _apply_h(M_inv, np.array([_SNAP_W * pos_l, 0.0]))
        b = _apply_h(M_inv, np.array([_SNAP_W * pos_l, float(_SNAP_H - 1)]))
        return a, (b - a) / (np.linalg.norm(b - a) + 1e-9)

    def line_right() -> tuple[np.ndarray, np.ndarray]:
        x = _SNAP_W * (1.0 - pos_r)  # pos_r ist Abstand vom rechten Rand
        a = _apply_h(M_inv, np.array([x, 0.0]))
        b = _apply_h(M_inv, np.array([x, float(_SNAP_H - 1)]))
        return a, (b - a) / (np.linalg.norm(b - a) + 1e-9)

    def line_top() -> tuple[np.ndarray, np.ndarray]:
        a = _apply_h(M_inv, np.array([0.0, _SNAP_H * pos_t]))
        b = _apply_h(M_inv, np.array([float(_SNAP_W - 1), _SNAP_H * pos_t]))
        return a, (b - a) / (np.linalg.norm(b - a) + 1e-9)

    def line_bottom() -> tuple[np.ndarray, np.ndarray]:
        y = _SNAP_H * (1.0 - pos_b)  # pos_b ist Abstand vom unteren Rand
        a = _apply_h(M_inv, np.array([0.0, y]))
        b = _apply_h(M_inv, np.array([float(_SNAP_W - 1), y]))
        return a, (b - a) / (np.linalg.norm(b - a) + 1e-9)

    left, right, top, bottom = line_left(), line_right(), line_top(), line_bottom()
    new_q = np.array(
        [
            _line_intersect(*left, *top),  # oben-links
            _line_intersect(*right, *top),  # oben-rechts
            _line_intersect(*right, *bottom),  # unten-rechts
            _line_intersect(*left, *bottom),  # unten-links
        ],
        dtype=np.float64,
    )
    if not np.isfinite(new_q).all():
        if TRACE_SNAP and snap_trace:
            snap_trace[-1]["guard"] = "nonfinite"
        return quad
    # Stabilität: keine Sprünge > 12 % der kürzeren Quad-Seite zulassen
    side = min(float(np.linalg.norm(quad[1] - quad[0])), float(np.linalg.norm(quad[3] - quad[0])))
    move = float(np.abs(new_q - quad).max())
    if TRACE_SNAP and snap_trace:
        snap_trace[-1]["move"] = move
        snap_trace[-1]["side"] = side
        snap_trace[-1]["new_q"] = new_q.copy()
    if move > 0.12 * side:
        if TRACE_SNAP and snap_trace:
            snap_trace[-1]["guard"] = "reject"
        return quad
    if TRACE_SNAP and snap_trace:
        snap_trace[-1]["guard"] = "ok"
        snap_trace[-1]["result"] = new_q.copy()
    return order_points(new_q.astype(np.float32))


# ---------------------------------------------------------------- Kandidaten


def _quad_candidates(gray: np.ndarray) -> list[tuple[np.ndarray, float, float]]:
    h0, w0 = gray.shape
    max_dim = 1280
    scale = min(1.0, max_dim / max(h0, w0))
    if scale < 1.0:
        small = cv2.resize(gray, (int(w0 * scale), int(h0 * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = gray
    hs, ws = small.shape
    img_area = float(hs * ws)
    inv_scale = 1.0 / scale  # Kandidaten zurück ins Originalbild überführen

    blurred = cv2.GaussianBlur(small, (5, 5), 0)

    # Zwei Kantenquellen: Canny + adaptiver Schwellwert (hilft bei dunklen Fotos)
    edges = cv2.Canny(blurred, 40, 130)
    thr = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 12
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.morphologyEx(edges | thr, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:25]

    results: list[tuple[np.ndarray, float, float]] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 0.10 * img_area or area > 1.001 * img_area:
            continue
        peri = cv2.arcLength(cnt, True)
        quad = None
        # Wichtig: Epsilon von klein nach groß – ein zu großes Epsilon schneidet
        # die abgerundeten Ecken der Kante ab und liefert ein zu kleines Viereck.
        for eps in (0.004, 0.006, 0.008, 0.01, 0.014, 0.02, 0.03, 0.045, 0.06):
            approx = cv2.approxPolyDP(cnt, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                quad = approx.reshape(4, 2).astype(np.float32)
                break
        if quad is None:
            rect = cv2.minAreaRect(cnt)
            if min(rect[1]) < 0.15 * min(hs, ws):
                continue
            quad = cv2.boxPoints(rect).astype(np.float32)

        quad = order_points(quad)
        w = np.linalg.norm(quad[1] - quad[0])
        h = np.linalg.norm(quad[3] - quad[0])
        if w < 10 or h < 10:
            continue
        ratio = w / h
        ratio = ratio if ratio <= 1 else 1.0 / ratio  # gegen Rotationsverwirrung
        # Enges Fenster um 63:88 – beugt Quadaten aus Artwork/Textboxen vor
        if not (0.62 <= ratio <= 0.82):
            continue

        fill = area / max(cv2.contourArea(cv2.convexHull(quad.astype(np.float32))), 1.0)
        ratio_score = 1.0 - abs(ratio - CARD_RATIO) / 0.12
        area_score = min(area / img_area, 1.0)
        score = 0.50 * ratio_score + 0.35 * area_score + 0.15 * fill
        results.append(
            (quad.astype(np.float32) * inv_scale, float(score), float(area / img_area))
        )

    results.sort(key=lambda r: r[1], reverse=True)
    if not results:
        return []

    best_quad, best_score, best_area = results[0]
    kept: list[tuple[np.ndarray, float, float]] = [(best_quad, best_score, best_area)]
    for quad, score, ar in results[1:]:
        if score >= 0.92 * best_score and abs(ar - best_area) > 0.01:
            kept.append((quad, score, ar))
        if len(kept) >= 4:
            break
    return kept


# ------------------------------------------------- Kanten-Snap (Verfeinerung)


def _edge_offsets(
    grad: np.ndarray, p0: np.ndarray, p1: np.ndarray, normal: np.ndarray, span: int = 48
) -> tuple[float, float]:
    """Verschiebt eine Kante entlang ihrer Normalen an die stärkste Kante im Gradienten."""
    n = 64
    t = np.linspace(0.0, 1.0, n)
    base = p0[None, :] + (p1 - p0)[None, :] * t[:, None]  # (n,2)
    offs = np.arange(-span, span + 1, dtype=np.float32)  # (K,)
    pts = base[None, :, :] + offs[:, None, None] * normal[None, None, :]  # (K,n,2)

    h, w = grad.shape
    xi = np.clip(pts[..., 0].astype(int), 0, w - 1)
    yi = np.clip(pts[..., 1].astype(int), 0, h - 1)
    inside = (
        (pts[..., 0] >= 0) & (pts[..., 0] < w) & (pts[..., 1] >= 0) & (pts[..., 1] < h)
    )
    vals = grad[yi, xi]
    vals = np.where(inside, vals, -1.0)
    # Median robust gegen einzelne Textkanten innerhalb der Karte (vektorisiert)
    scores = np.median(vals, axis=1)

    best = int(np.argmax(scores))
    if 0 < best < len(scores) - 1:
        y0, y1, y2 = scores[best - 1], scores[best], scores[best + 1]
        denom = y0 - 2 * y1 + y2
        delta = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-9 else 0.0
        delta = float(np.clip(delta, -1.0, 1.0))
    else:
        delta = 0.0
    return float(best - span) + delta, float(scores[best])


def _line_intersect(p1: np.ndarray, d1: np.ndarray, p2: np.ndarray, d2: np.ndarray) -> np.ndarray:
    A = np.array([d1, -d2], dtype=np.float64).T
    b = (p2 - p1).astype(np.float64)
    try:
        t = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return (p1 + p2) / 2.0
    return p1 + t[0] * d1


def refine_quad(gray: np.ndarray, quad: np.ndarray, passes: int = 2) -> np.ndarray:
    """Sucht für jede der 4 Kanten den Kantenverlauf im Gradienten und
    berechnet die Ecken als Schnittpunkt der verfeinerten Kantenlinien."""
    g = gray.astype(np.float32)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy)
    grad = cv2.GaussianBlur(grad, (5, 5), 0)

    q = order_points(quad).astype(np.float64)
    for _ in range(passes):
        center = q.mean(axis=0)
        lines: list[tuple[np.ndarray, np.ndarray]] = []
        for i in range(4):
            p0, p1 = q[i], q[(i + 1) % 4]
            d = p1 - p0
            length = np.linalg.norm(d)
            if length < 1:
                lines.append((p0, np.array([1.0, 0.0])))
                continue
            d = d / length
            n = np.array([-d[1], d[0]])
            # Normalenrichtung nach außen
            mid = (p0 + p1) / 2.0
            if np.dot(n, mid - center) < 0:
                n = -n
            span = int(np.clip(0.06 * max(grad.shape), 24, 64))
            off, _strength = _edge_offsets(grad, p0, p1, n, span=span)
            p0r, p1r = p0 + n * off, p1 + n * off
            # Kantenlänge leicht strecken → stabilerer Schnittpunkt
            stretch = 0.15 * length
            p0r, p1r = p0r - d * stretch, p1r + d * stretch
            lines.append((p0r, d))

        new_q = np.array(
            [
                _line_intersect(*lines[(i - 1) % 4], *lines[i]) for i in range(4)
            ],
            dtype=np.float64,
        )
        if not np.isfinite(new_q).all():
            break
        # Stabilität: keine extremen Sprünge zulassen
        if np.abs(new_q - q).max() > 0.15 * max(grad.shape):
            break
        q = new_q

    return order_points(q.astype(np.float32))


def _refine_corners(gray: np.ndarray, quad: np.ndarray) -> np.ndarray:
    quad = refine_quad(gray, quad)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.01)
    try:
        refined = cv2.cornerSubPix(
            gray,
            quad.astype(np.float32).reshape(-1, 1, 2),
            (7, 7),
            (-1, -1),
            criteria,
        ).reshape(4, 2)
        if np.isfinite(refined).all() and np.abs(refined - quad).max() < 40:
            quad = refined.astype(np.float32)
    except cv2.error:
        pass
    return order_points(quad)


# ------------------------------------------------------------------- public

USE_SNAP = False  # Rand-Snap im Warp-Raum (Evaluation: kaum besser als Rohkandidat)
USE_REFINE = False  # Gradienten-Linienverfeinerung (Evaluation: deutlich schlechter)


def find_cards(image: np.ndarray) -> list[Detection]:
    """Liefert ALLE Karten-Kandidaten (nach Flächenanteil absteigend)."""
    if image is None or image.size == 0:
        return []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    if gray.shape[0] > 2000:
        s = 2000 / gray.shape[0]
        gray_det = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        inv_scale = 1.0 / s
    else:
        gray_det = gray
        inv_scale = 1.0

    candidates = _quad_candidates(gray_det)
    if not candidates:
        return []

    dets: list[Detection] = []
    for quad, score, area_ratio in candidates:
        q0 = order_points(quad) * inv_scale  # Originalbild-Koordinaten
        if USE_SNAP and image.ndim == 3:
            q = snap_borders(image, q0)
        elif USE_REFINE:
            q = _refine_corners(gray_det, order_points(quad)) * inv_scale
        else:
            q = q0
        dets.append(Detection(corners=q, score=score, area_ratio=area_ratio))
    dets.sort(key=lambda d: d.area_ratio, reverse=True)
    return dets


def find_card(image: np.ndarray) -> Detection | None:
    """Liefert die erkannte Karten-Position im Originalbild (oder None)."""
    cards = find_cards(image)
    return cards[0] if cards else None


def detect_and_warp(image: np.ndarray) -> tuple[np.ndarray | None, Detection | None]:
    """Erkenne die Karte und liefere den gewarpten Karten-Ausschnitt."""
    det = find_card(image)
    if det is None:
        return None, None
    return warp_card(image, det.corners), det
