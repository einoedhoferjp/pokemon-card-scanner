"""Prototyp 2: Quad-Varianten + Warp-Raum-Score (Randkontrast)."""
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


def warp_to(image, quad, w=160, h=224):
    src = detect.order_points(quad).astype(np.float32)
    dst = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, M, (w, h), flags=cv2.INTER_AREA)


def scale_quad(quad, f):
    c = quad.mean(axis=0)
    return ((quad - c) * f + c).astype(np.float32)


def score_quad(color, quad) -> float:
    """Kantenkontrast innen/außen + Uniformität des Kartenrandbands."""
    big = scale_quad(quad, 1.20)
    crop_in = warp_to(color, quad, 160, 224)
    crop_out = warp_to(color, big, 160, 224)
    h, w = crop_out.shape[:2]

    # Innenband: 3-13 % Abstand zur Kante im Karten-Warp
    yy, xx = np.mgrid[0:h, 0:w]
    u = xx / (w - 1)
    v = yy / (h - 1)
    d_in = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))
    inner = (d_in >= 0.03) & (d_in <= 0.13)

    # Außenband: äußerer Ring des 1,20-fach Warps (direkt neben dem Quad)
    m = max(2, int(0.055 * w))
    outer = np.zeros((h, w), bool)
    outer[:m, :] = outer[-m:, :] = True
    outer[:, :m] = outer[:, -m:] = True

    if crop_in.shape[:2] != (h, w):
        return -1e9
    in_px = crop_in[inner].astype(np.float32)
    out_px = crop_out[outer].astype(np.float32)

    step = float(np.linalg.norm(in_px.mean(axis=0) - out_px.mean(axis=0)))
    stds = float(in_px.std(axis=0).mean() + out_px.std(axis=0).mean())
    contrast = step / (stds + 1e-3)
    uniform = 1.0 / (1.0 + float(in_px.std(axis=0).mean()) / 25.0)
    return contrast * 0.8 + 4.0 * uniform


def aspect_prior(quad):
    w = np.linalg.norm(quad[1] - quad[0])
    h = np.linalg.norm(quad[3] - quad[0])
    r = w / h
    if r > 1:
        r = 1 / r
    return 1.0 - abs(r - detect.CARD_RATIO) / 0.25


def variants(quad, gray):
    out = {"raw": quad}
    try:
        out["refine"] = detect.refine_quad(gray, quad)
    except Exception:
        pass
    for f in (1.03, 1.06, 1.10):
        out[f"out{int(f*100)}"] = scale_quad(quad, f)
    for f in (0.96, 0.93):
        out[f"in{int(f*100)}"] = scale_quad(quad, f)
    return out


def main():
    rng = random.Random(1)
    files = sorted(ed.REF_DIR.glob("*.jpg"))
    sample = rng.sample(files, 40)

    stats = {"raw": 0, "scored": 0, "oracle": 0, "none": 0}
    for p in sample:
        card = cv2.imread(str(p))
        if card is None:
            continue
        photo, gt = ed.make_photo(card, rng)
        gray = cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)
        cands = detect._quad_candidates(gray)
        if not cands:
            stats["none"] += 1
            print(f"{p.name:22s} KEINE KANDIDATEN")
            continue
        allv = {}
        for q, s, ar in cands:
            for name, v in variants(q.astype(np.float32), gray).items():
                sc = score_quad(photo, v) + 2.0 * aspect_prior(v) + 0.2 * ar
                allv[(id(q), name)] = (sc, v, name)
        raw = cands[0][0].astype(np.float32)
        e_raw = ed.corner_error(raw, gt, photo.shape[:2])
        ranked = sorted(allv.values(), key=lambda t: t[0], reverse=True)
        e_pick = ed.corner_error(ranked[0][1], gt, photo.shape[:2])
        e_or = min(ed.corner_error(v, gt, photo.shape[:2]) for _, v, _ in ranked)
        stats["raw"] += e_raw < 2
        stats["scored"] += e_pick < 2
        stats["oracle"] += e_or < 2
        print(
            f"{p.name:22s} raw={e_raw:6.2f}  picked={e_pick:6.2f} ({ranked[0][2]:7s}) "
            f" oracle={e_or:6.2f}"
        )
    print("\n", stats, "/ 40")


if __name__ == "__main__":
    main()
