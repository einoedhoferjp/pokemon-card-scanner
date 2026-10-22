"""Offline-Tuning der Konsens-Fusion auf gedumpten Signalen.

Liest data/eval_signals.pkl (scripts.dump_signals) + Katalog und bewertet
verschiedene Gewichtungen/Schwellen: Top-1, Top-3, Auto-Rate, Falsch-Auto.

Aufruf (aus apps/rec):
    python -m scripts.tune_fusion [--signals ../../data/eval_signals.pkl]
"""

from __future__ import annotations

import argparse
import itertools
import pathlib
import pickle
import sys
from dataclasses import dataclass

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.catalog import get_catalog  # noqa: E402
from app.matcher import best_name_score, number_match  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


@dataclass
class Case:
    truth: str
    ids: list[str]
    dist: np.ndarray      # int, -1 = kein pHash-Treffer
    sim: np.ndarray       # float, nan = kein Embedding-Treffer
    num: np.ndarray       # number_match, -1 = unbekannt
    name: np.ndarray      # best_name_score, -1 = unbekannt


@dataclass
class Cfg:
    w_emb: float = 0.55
    w_phash: float = 0.45
    w_vision: float = 0.65
    w_num: float = 0.20
    w_name: float = 0.15
    phash_zero: float = 32.0
    emb_low: float = 0.55
    emb_high: float = 0.90
    auto_final: float = 0.85
    auto_margin: float = 0.08

    def label(self) -> str:
        return (
            f"emb={self.w_emb:.2f} ph={self.w_phash:.2f} pz={self.phash_zero:.0f} "
            f"lo={self.emb_low:.2f} hi={self.emb_high:.2f} "
            f"wnum={self.w_num:.2f} wname={self.w_name:.2f} "
            f"af={self.auto_final:.2f} am={self.auto_margin:.2f}"
        )


def load_cases(path: pathlib.Path) -> list[Case]:
    with open(path, "rb") as fh:
        recs = pickle.load(fh)["records"]
    cat = get_catalog()
    cases: list[Case] = []
    for r in recs:
        # Pipeline-Semantik nachbilden: pHash <= 32, jeweils Top-30
        ph = [(cid, d) for cid, d in r["ph"] if d <= 32][:30]
        emb = list(r["emb"])[:30]
        ids = list(dict.fromkeys([c[0] for c in ph] + [c[0] for c in emb]))
        dist_map = dict(ph)
        sim_map = dict(emb)
        ids = [i for i in ids if cat.get(i) is not None]
        dist = np.array([dist_map.get(i, -1) for i in ids], dtype=np.int32)
        sim = np.array([sim_map.get(i, np.nan) for i in ids], dtype=np.float64)
        num = np.array([number_match(r["ocr_number"], cat.get(i).number) for i in ids])
        name = np.array([best_name_score(r["ocr_name"], cat.get(i)) for i in ids])
        cases.append(
            Case(truth=r["truth"], ids=ids, dist=dist, sim=sim, num=num, name=name)
        )
    return cases


def score_case(c: Case, cfg: Cfg) -> tuple[np.ndarray, np.ndarray]:
    """Liefert (final, vision) je Kandidat."""
    m = c.dist >= 0
    ph = np.zeros_like(c.sim)
    ph[m] = np.clip(1.0 - c.dist[m] / cfg.phash_zero, 0.0, 1.0)
    m2 = ~np.isnan(c.sim)
    emb = np.zeros_like(c.sim)
    emb[m2] = np.clip((c.sim[m2] - cfg.emb_low) / (cfg.emb_high - cfg.emb_low), 0.0, 1.0)

    vis_acc = np.where(m, ph * cfg.w_phash, 0.0) + np.where(m2, emb * cfg.w_emb, 0.0)
    wsum = np.where(m, cfg.w_phash, 0.0) + np.where(m2, cfg.w_emb, 0.0)
    vision = np.divide(vis_acc, wsum, out=np.zeros_like(vis_acc), where=wsum > 0)

    weighted = cfg.w_vision * vision
    total_w = np.full_like(vision, cfg.w_vision)
    has_num = c.num >= 0
    weighted = weighted + np.where(has_num, cfg.w_num * c.num, 0.0)
    total_w = total_w + np.where(has_num, cfg.w_num, 0.0)
    has_name = c.name >= 0
    weighted = weighted + np.where(has_name, cfg.w_name * c.name, 0.0)
    total_w = total_w + np.where(has_name, cfg.w_name, 0.0)
    final = np.divide(weighted, total_w, out=np.zeros_like(weighted), where=total_w > 0)
    return final, vision


def decide_case(c: Case, final: np.ndarray, cfg: Cfg) -> bool:
    """Spiegelt matcher.decide (vereinfacht) fuer die Auto-Metrik."""
    if len(final) == 0:
        return False
    order = np.argsort(-final)
    k = int(order[0])
    margin = 1.0 if len(final) == 1 else float(final[order[0]] - final[order[1]])
    num = float(c.num[k])
    name = float(c.name[k])
    if 0 <= num < 0.5:
        return False
    if name >= 0 and name < 0.30 and num < 0:
        return False
    ocr_ok = num >= 0.99 and name >= 0.75
    emb_ok = (not np.isnan(c.sim[k])) and (
        (c.sim[k] - cfg.emb_low) / (cfg.emb_high - cfg.emb_low) >= 0.5
    )
    vis_ok = (c.dist[k] >= 0 and c.dist[k] <= 8) and emb_ok
    return bool(final[k] >= cfg.auto_final and margin >= cfg.auto_margin and (ocr_ok or vis_ok))


def evaluate(cases: list[Case], cfg: Cfg) -> tuple[float, float, float, float]:
    n = len(cases)
    top1 = top3 = auto = false_auto = 0
    for c in cases:
        if not c.ids:
            continue
        final, _ = score_case(c, cfg)
        order = np.argsort(-final)
        ranked = [c.ids[int(i)] for i in order[:3]]
        if ranked[:1] == [c.truth]:
            top1 += 1
        if c.truth in ranked:
            top3 += 1
        if decide_case(c, final, cfg):
            auto += 1
            if ranked[:1] != [c.truth]:
                false_auto += 1
    return top1 / n, top3 / n, auto / n, (false_auto / auto if auto else 0.0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--signals", type=str, default=str(REPO_ROOT / "data" / "eval_signals.pkl"))
    ap.add_argument("--grid", action="store_true", help="groessere Suche statt nur Baselines")
    args = ap.parse_args()

    cases = load_cases(pathlib.Path(args.signals))
    print(f"{len(cases)} Faelle geladen")
    nph = sum((c.dist >= 0).any() for c in cases)
    print(f"mit pHash-Treffer: {nph}, mit Embedding: {sum((~np.isnan(c.sim)).any() for c in cases)}")

    baseline = Cfg()
    t1, t3, au, fa = evaluate(cases, baseline)
    print(f"\nBASELINE  Top-1={t1 * 100:.1f}%  Top-3={t3 * 100:.1f}%  "
          f"Auto={au * 100:.1f}%  Falsch-Auto={fa * 100:.2f}%")
    print(f"          {baseline.label()}")

    if not args.grid:
        for cfg in [
            Cfg(w_emb=0.75, w_phash=0.25),
            Cfg(w_emb=0.85, w_phash=0.15),
            Cfg(w_emb=0.65, w_phash=0.35),
            Cfg(w_emb=0.55, w_phash=0.45, phash_zero=16.0),
            Cfg(w_emb=0.75, w_phash=0.25, phash_zero=16.0, emb_low=0.45, emb_high=0.85),
            Cfg(w_emb=0.75, w_phash=0.25, w_num=0.30, w_name=0.10),
            Cfg(w_emb=0.85, w_phash=0.15, w_num=0.25, w_name=0.10, phash_zero=16.0),
        ]:
            t1, t3, au, fa = evaluate(cases, cfg)
            print(f"   Top-1={t1 * 100:5.1f}%  Top-3={t3 * 100:5.1f}%  "
                  f"Auto={au * 100:5.1f}%  FA={fa * 100:5.2f}%  {cfg.label()}")
        return 0

    results: list[tuple[float, float, float, float, Cfg]] = []
    w_embs = [0.45, 0.55, 0.65, 0.75, 0.85, 1.0]
    pz = [12.0, 16.0, 24.0, 32.0]
    lo = [0.40, 0.55, 0.65]
    hi = [0.85, 0.90, 0.95]
    wnum = [0.15, 0.20, 0.30]
    wname = [0.05, 0.15, 0.25]
    combos = list(itertools.product(w_embs, pz, lo, hi, wnum, wname))
    print(f"Suche {len(combos)} Konfigurationen ...")
    for we, z, l, h, wn, wm in combos:
        cfg = Cfg(w_emb=we, w_phash=1.0 - we, phash_zero=z, emb_low=l, emb_high=h,
                  w_num=wn, w_name=wm)
        t1, t3, au, fa = evaluate(cases, cfg)
        if fa == 0.0:
            results.append((t1, t3, au, fa, cfg))
    results.sort(key=lambda r: (-r[0], -r[1], -r[2]))
    print(f"\nTop 12 (Falsch-Auto=0):")
    for t1, t3, au, fa, cfg in results[:12]:
        print(f"   Top-1={t1 * 100:5.1f}%  Top-3={t3 * 100:5.1f}%  "
              f"Auto={au * 100:5.1f}%  FA={fa * 100:5.2f}%  {cfg.label()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
