"""Experiment: Quad aus Kontur-Extremen im lokalen Rahmen vs. approxPolyDP."""
import importlib.util
import random
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "rec"))

from app import detect  # noqa: E402

spec = importlib.util.spec_from_file_location("ed", ROOT / "scripts" / "eval_detect.py")
ed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ed)


def edges_of(gray: np.ndarray) -> np.ndarray:
    h0, w0 = gray.shape
    scale = min(1.0, 1280 / max(h0, w0))
    small = (
        cv2.resize(gray, (int(w0 * scale), int(h0 * scale)), interpolation=cv2.INTER_AREA)
        if scale < 1
        else gray
    )
    return scale, small


def extreme_quad(cnt: np.ndarray, quad: np.ndarray, grow: float = 0.15) -> np.ndarray:
    c = quad.mean(axis=0)
    d = quad[1] - quad[0]
    ang = np.arctan2(d[1], d[0])
    ca, sa = np.cos(-ang), np.sin(-ang)
    R = np.array([[ca, -sa], [sa, ca]])
    pts = (cnt.reshape(-1, 2).astype(np.float32) - c) @ R.T
    x0, x1 = np.percentile(pts[:, 0], [0.3, 99.7])
    y0, y1 = np.percentile(pts[:, 1], [0.3, 99.7])
    # Wachstum gegenüber dem Ausgangsquad begrenzen
    w0, h0 = quad[1] - quad[0], quad[3] - quad[0]
    w_len, h_len = np.linalg.norm(w0), np.linalg.norm(h0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x0, x1 = cx + np.clip([x0 - cx, x1 - cx], -w_len / 2 * (1 + grow), w_len / 2 * (1 + grow))
    y0, y1 = cy + np.clip([y0 - cy, y1 - cy], -h_len / 2 * (1 + grow), h_len / 2 * (1 + grow))
    local = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)
    return local @ R + c  # Rückdrehung


def main() -> int:
    n, seed = 40, 1
    rng = random.Random(seed)
    files = sorted(p for p in ed.REF_DIR.glob("*.jpg"))
    sample = rng.sample(files, n)

    grows = [0.0, 0.03, 0.06, 0.15]
    stats = {g: [0, 0, 0] for g in grows}  # [gewinn, verlust, unter 2 %]
    stats_baseline = 0
    total = n
    for path in sample:
        card = cv2.imread(str(path))
        if card is None:
            continue
        photo, gt = ed.make_photo(card, rng)
        gray = cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)
        cands = detect._quad_candidates(gray)
        if not cands:
            print(f"{path.name:22s} KEINE KANDIDATEN")
            continue
        q0 = cands[0][0].astype(np.float32)
        raw = ed.corner_error(q0, gt, photo.shape[:2])

        scale, small = edges_of(gray)
        hs, ws = small.shape
        bl = cv2.GaussianBlur(small, (5, 5), 0)
        e = cv2.Canny(bl, 40, 130)
        thr = cv2.adaptiveThreshold(bl, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 12)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        e = cv2.morphologyEx(e | thr, cv2.MORPH_CLOSE, k, iterations=2)
        cs, _ = cv2.findContours(e, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cs = sorted(cs, key=cv2.contourArea, reverse=True)[:25]

        seed_quad, seed_cnt = None, None
        for cnt in cs:
            if not (0.10 * hs * ws <= cv2.contourArea(cnt) <= 1.001 * hs * ws):
                continue
            peri = cv2.arcLength(cnt, True)
            quad = None
            for eps in (0.004, 0.006, 0.008, 0.01, 0.014, 0.02, 0.03, 0.045, 0.06):
                ap = cv2.approxPolyDP(cnt, eps * peri, True)
                if len(ap) == 4 and cv2.isContourConvex(ap):
                    quad = ap.reshape(4, 2).astype(np.float32)
                    break
            if quad is None:
                rect = cv2.minAreaRect(cnt)
                quad = cv2.boxPoints(rect).astype(np.float32)
            seed_quad, seed_cnt = detect.order_points(quad), cnt
            break
        if seed_quad is None:
            print(f"{path.name:22s} raw={raw:.2f}  kein Seed")
            continue

        seed_err = ed.corner_error(seed_quad / scale, gt, photo.shape[:2])
        if seed_err < 2.0:
            stats_baseline += 1
        line = f"{path.name:22s} seed={seed_err:6.2f} "
        for g in grows:
            cand = detect.order_points((extreme_quad(seed_cnt, seed_quad, g) / scale).astype(np.float32))
            err = ed.corner_error(cand, gt, photo.shape[:2])
            line += f" g{g:.2f}={err:5.2f}"
            if err < 2.0:
                stats[g][2] += 1
        print(line)

    print(f"\nBasis (approxPolyDP, kein Extrem): {stats_baseline} von {total} unter 2 %")
    for g in grows:
        print(f"grow={g}: {stats[g][2]} von {total} unter 2 %")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
