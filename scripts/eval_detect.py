"""Detection-Evaluation: simulierte Fotos aus Referenzbildern.

Erzeugt pro Karte ein zufälliges „Foto" (Perspektive, Rotation, Licht, Rauschen,
Unschärfe, Hintergrund) und misst die Eckenabweichung der Kartenerkennung.

Aufruf:  .venv/bin/python scripts/eval_detect.py [--n 40] [--seed 1]
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "rec"))

from app import detect  # noqa: E402

REF_DIR = ROOT / "data" / "ref_cache" / "cards"


def make_photo(
    card: np.ndarray, rng: random.Random
) -> tuple[np.ndarray, np.ndarray]:
    """Hängt die Karte mit zufälliger Perspektive in eine Szene → (foto, gt_ecken)."""
    h, w = card.shape[:2]
    canvas_w = rng.randint(900, 1500)
    canvas_h = rng.randint(1100, 1900)
    bg = np.zeros((canvas_h, canvas_w, 3), np.uint8)
    base = rng.randint(40, 200)
    bg[:] = (
        int(np.clip(base + rng.randint(-25, 25), 0, 255)),
        int(np.clip(base + rng.randint(-25, 25), 0, 255)),
        int(np.clip(base + rng.randint(-25, 25), 0, 255)),
    )
    # leicht strukturierter Hintergrund (Tisch/Hand)
    noise = rng.randint(0, 40)
    if noise:
        bg = np.clip(
            bg.astype(np.int16)
            + np.random.default_rng(rng.randint(0, 10**6)).normal(0, noise / 4, bg.shape),
            0,
            255,
        ).astype(np.uint8)

    # Ziel-Ecken: Karte gut sichtbar, leichte zufällige Neigung
    cx, cy = canvas_w / 2, canvas_h / 2
    card_h = canvas_h * rng.uniform(0.55, 0.86)
    card_w = card_h * (w / h)
    angle = rng.uniform(-14, 14)
    skew = rng.uniform(-0.10, 0.10)
    scale = rng.uniform(0.90, 1.10)

    def place(dx: float, dy: float) -> list[float]:
        # dx/dy in Einheiten relativ zur Kartenmitte, gedreht + verschoben
        x = dx * card_w / 2 * scale
        y = dy * card_h / 2 * scale
        xr = x * np.cos(np.radians(angle)) - y * np.sin(np.radians(angle))
        yr = x * np.sin(np.radians(angle)) + y * np.cos(np.radians(angle))
        return [cx + xr + skew * y, cy + yr]

    gt = np.array(
        [place(-1, -1), place(1, -1), place(1, 1), place(-1, 1)], dtype=np.float32
    )

    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    M = cv2.getPerspectiveTransform(src, gt)
    warped = cv2.warpPerspective(card, M, (canvas_w, canvas_h), flags=cv2.INTER_LANCZOS4)
    mask = cv2.warpPerspective(
        np.full((h, w), 255, np.uint8), M, (canvas_w, canvas_h), flags=cv2.INTER_NEAREST
    )

    photo = bg.copy()
    photo[mask > 127] = warped[mask > 127]

    # Licht: Verlauf + globale Helligkeit
    gx = np.linspace(rng.uniform(0.7, 1.25), rng.uniform(0.75, 1.3), canvas_w)
    gy = np.linspace(rng.uniform(0.8, 1.2), rng.uniform(0.8, 1.2), canvas_h)
    grad = np.clip(gy[:, None] * gx[None, :], 0.5, 1.6)
    photo = np.clip(photo.astype(np.float32) * grad[..., None], 0, 255).astype(np.uint8)

    # Glanzfleck (Spiegelung) in ~30 % der Fälle
    if rng.random() < 0.3:
        px, py = rng.randint(0, canvas_w), rng.randint(0, canvas_h)
        rad = rng.randint(60, 200)
        yy, xx = np.ogrid[:canvas_h, :canvas_w]
        blob = np.clip(1.0 - ((xx - px) ** 2 + (yy - py) ** 2) / rad**2, 0, 1)
        photo = np.clip(photo + blob[..., None] * rng.randint(60, 140), 0, 255).astype(
            np.uint8
        )

    # Unschärfe + Rauschen
    if rng.random() < 0.5:
        k = rng.choice([3, 3, 5])
        photo = cv2.GaussianBlur(photo, (k, k), rng.uniform(0.4, 1.4))
    sigma = rng.uniform(1.0, 5.0)
    photo = np.clip(
        photo.astype(np.float32)
        + np.random.default_rng(rng.randint(0, 10**6)).normal(0, sigma, photo.shape),
        0,
        255,
    ).astype(np.uint8)

    return photo, gt


def corner_error(pred: np.ndarray, gt: np.ndarray, image_shape: tuple[int, int]) -> float:
    """Mittlere Eckenabweichung in % der Kartenhöhe (skalenunabhängig)."""
    card_h = float(
        (np.linalg.norm(gt[1] - gt[0]) + np.linalg.norm(gt[2] - gt[3])) / 2
    )
    if card_h <= 0:
        return 100.0
    return float(np.mean(np.linalg.norm(pred - gt, axis=1)) / card_h * 100)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--save-failures", type=int, default=5)
    ap.add_argument(
        "--mode",
        choices=["snap", "refine", "raw"],
        default="raw",
        help="raw=Kandidat (Produktion), snap=Rand-Snap, refine=Linienverfeinerung",
    )
    args = ap.parse_args()

    detect.USE_SNAP = args.mode == "snap"
    detect.USE_REFINE = args.mode == "refine"
    if args.mode == "raw":
        detect._refine_corners = lambda gray, quad: detect.order_points(quad)  # type: ignore[assignment]

    files = sorted(p for p in REF_DIR.glob("*.jpg"))
    if not files:
        print("Keine Referenzbilder gefunden:", REF_DIR)
        return 1
    rng = random.Random(args.seed)
    sample = rng.sample(files, min(args.n, len(files)))

    errors: list[float] = []
    fails = 0
    saved = 0
    t0 = time.time()
    for i, path in enumerate(sample, 1):
        card = cv2.imread(str(path))
        if card is None:
            continue
        photo, gt = make_photo(card, rng)
        det = detect.find_card(photo)
        if det is None:
            errors.append(100.0)
            fails += 1
            print(f"[{i:3}/{len(sample)}] {path.name:20s} KEINE ERKENNUNG")
            continue
        err = corner_error(det.corners, gt, photo.shape[:2])
        errors.append(err)
        ok = err < 2.0
        if not ok:
            fails += 1
            if saved < args.save_failures:
                vis = photo.copy()
                cv2.polylines(vis, [gt.astype(np.int32).reshape(-1, 1, 2)], True, (0, 255, 0), 3)
                cv2.polylines(
                    vis, [det.corners.astype(np.int32).reshape(-1, 1, 2)], True, (0, 0, 255), 3
                )
                out = ROOT / "data" / f"eval_detect_fail_{path.stem}.jpg"
                cv2.imwrite(str(out), vis)
                saved += 1
        print(
            f"[{i:3}/{len(sample)}] {path.name:20s} err={err:6.2f}% {'OK' if ok else 'FAIL':4s} "
            f"({(time.time() - t0) / i * 1000:.0f} ms/Bild)"
        )

    arr = np.array(errors)
    print("\n=== Detection-Evaluation ===")
    print(f"Bilder:            {len(arr)}")
    print(f"Erkannt:           {int((arr < 100).sum())}")
    print(f"Erfolg (<2%):      {int((arr < 2).sum())} ({(arr < 2).mean() * 100:.1f} %)")
    print(f"Eckenfehler Median {np.median(arr):.2f} % der Kartenhöhe")
    print(f"Eckenfehler Mean   {arr.mean():.2f} %, P90 {np.percentile(arr, 90):.2f} %")
    print(f"Failures gespeichert unter data/eval_detect_fail_*.jpg")
    return 0 if (arr < 2).mean() >= 0.9 else 2


if __name__ == "__main__":
    raise SystemExit(main())
