"""Diagnose: Rand-Snap bei Fällen mit zu großem Eckenfehler."""
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


def main() -> int:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    detect.TRACE_SNAP = True
    rng = random.Random(seed)
    files = sorted(p for p in ed.REF_DIR.glob("*.jpg"))
    sample = rng.sample(files, min(n, len(files)))

    for i, path in enumerate(sample, 1):
        card = cv2.imread(str(path))
        if card is None:
            continue
        photo, gt = ed.make_photo(card, rng)
        detect.snap_trace.clear()
        cands = detect._quad_candidates(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY))
        raw = (
            ed.corner_error(cands[0][0].astype(np.float32), gt, photo.shape[:2])
            if cands
            else None
        )
        det = detect.find_card(photo)
        final = ed.corner_error(det.corners, gt, photo.shape[:2]) if det else None
        if raw is not None and raw < 2 and final is not None and final < 2:
            continue
        print(f"\n== {path.name}  raw={raw}  final={final}  ncand={len(cands)}")
        for t in detect.snap_trace:
            pos = tuple(round(p, 3) for p in t["pos"])
            sc = tuple(round(s, 2) for s in t["score"])
            print(f"   pos={pos}  score={sc}  base={t['base']:.3f}  guard={t.get('guard')}")
            if "move" in t:
                print(
                    f"   move={t['move']:.1f}  side={t['side']:.1f}  "
                    f"limit={0.12 * t['side']:.1f}"
                )
            if "new_q" in t:
                print(f"   new_q_err={ed.corner_error(t['new_q'], gt, photo.shape[:2]):.2f}")
            if "result" in t:
                res_err = ed.corner_error(t["result"], gt, photo.shape[:2])
                print(f"   result_err={res_err:.2f}  (raw war {raw})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
