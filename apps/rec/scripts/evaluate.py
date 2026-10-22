"""Evaluation der vollen Erkennungs-Pipeline auf simulierten Scan-Fotos.

Metriken:
- Top-1 / Top-3 Genauigkeit
- Auto-Uebernahme-Rate (Anteil Fotos mit auto_save=true)
- Falsch-Auto-Rate (auto_save=true, aber falsche Karte) -> Ziel: < 0,5 %
- Detektionsrate, Latenz

Aufruf (aus apps/rec):
    python -m scripts.evaluate --samples 300 [--seed 42] [--no-photos]
    python -m scripts.evaluate --real DIR     (echte Fotos, Ordnernamen = tcgdex_id)

Fuellt ggf. die simulierten Fotos aus scripts/eval_phash.py (gleiche Generierung).
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import random
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.pipeline import Recognizer  # noqa: E402
from scripts.eval_phash import simulate_photo  # noqa: E402


def case_seed(path: pathlib.Path, seed: int) -> int:
    """Prozess-unabhaengiger Seed (hash() waere pro Lauf zufaellig!)."""
    digest = hashlib.md5(f"{path}|{seed}".encode()).hexdigest()
    return int(digest[:8], 16)


def run(
    samples: int,
    seed: int,
    real_dir: str | None,
    verbose: bool,
    use_fallback: bool = True,
) -> int:
    rec = Recognizer()
    base = pathlib.Path("../../data/ref_cache/cards").resolve()

    if real_dir:
        cases: list[tuple[pathlib.Path, str]] = []
        d = pathlib.Path(real_dir)
        for f in sorted(d.iterdir()):
            if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".heic"):
                # Dateiname ohne Endung = erwartete tcgdex_id (z. B. base1-4.jpg)
                cases.append((f, f.stem))
        print(f"Echte Fotos: {len(cases)} aus {d}")
    else:
        files = sorted(base.glob("*.jpg"))
        rng = random.Random(seed)
        chosen = rng.sample(files, min(samples, len(files)))
        cases = [(f, f.stem) for f in chosen]
        print(f"Simulierte Fotos: {len(cases)} (seed={seed})")

    top1 = top3 = auto = false_auto = detected = n = 0
    latencies: list[float] = []
    misses: list[tuple[str, list[str]]] = []

    for path, truth in cases:
        img = cv2.imread(str(path))
        if img is None:
            continue
        photo = img if real_dir else simulate_photo(img, random.Random(case_seed(path, seed)))
        t0 = time.time()
        res = rec.recognize(photo, use_fallback=use_fallback)
        latencies.append(time.time() - t0)
        n += 1
        if res.quality.get("card_detected"):
            detected += 1

        ids = [c.card_id for c in res.candidates]
        hit1 = bool(ids) and ids[0] == truth
        hit3 = truth in ids
        top1 += hit1
        top3 += hit3
        if res.auto_save:
            auto += 1
            if not hit1:
                false_auto += 1
                misses.append((truth, ids))
        if not hit3:
            misses.append((truth, ids))
        if verbose and (not hit1 or res.auto_save):
            mark = "OK " if hit1 else "FALSCH"
            print(
                f"  [{mark}] truth={truth:16s} got={ids[:3]} auto={res.auto_save} "
                f"ocr={res.ocr_name!r}/{res.ocr_number} ({res.reason[:50]})"
            )

    if n == 0:
        print("Keine Auswertungsbilder gefunden.")
        return 1

    lat = np.array(latencies)
    print("\n" + "=" * 62)
    print(f"ERGEBNIS ({n} Fotos{' echt' if real_dir else ' simuliert'})")
    print("=" * 62)
    print(f"Detektion:        {detected}/{n} ({detected / n * 100:.1f}%)")
    print(f"Top-1:            {top1}/{n} ({top1 / n * 100:.1f}%)")
    print(f"Top-3:            {top3}/{n} ({top3 / n * 100:.1f}%)")
    print(f"Auto-Rate:        {auto}/{n} ({auto / n * 100:.1f}%)")
    fa_rate = (false_auto / auto * 100) if auto else 0.0
    print(f"Falsch-Auto:      {false_auto}/{auto} ({fa_rate:.2f}% der Autos)  [Ziel < 0.5%]")
    print(f"Latenz:           p50={np.percentile(lat, 50) * 1000:.0f}ms  "
          f"p95={np.percentile(lat, 95) * 1000:.0f}ms  max={lat.max() * 1000:.0f}ms")
    if misses:
        print(f"\nFehler ({len(misses)}), erst 15:")
        for truth, got in misses[:15]:
            print(f"  {truth:16s} -> {got}")
    verdict = fa_rate < 0.5 and auto > 0
    print(f"\nAuto-Schwelle erfuellt (<0.5% falsch): {'JA' if verdict else 'NEIN'}")
    return 0 if verdict else 2


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=300)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--real", type=str, default="")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument(
        "--no-fallback",
        action="store_true",
        help="Multi-Crop-Fallback bei Detektionsfehlern deaktivieren (A/B-Vergleich)",
    )
    args = ap.parse_args()
    sys.exit(
        run(
            args.samples,
            args.seed,
            args.real or None,
            args.verbose,
            use_fallback=not args.no_fallback,
        )
    )


if __name__ == "__main__":
    main()
