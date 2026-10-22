"""Unit-Tests: Konsens-Fusion, OCR-Helfer, pHash."""

from __future__ import annotations

import numpy as np

from app.catalog import CardMeta
from app.matcher import (
    CandidateScore,
    decide,
    emb_score,
    fuse,
    name_similarity,
    number_match,
    phash_score,
    recognize,
)
from app.ocr import digits_only, is_numeric, normalize_digits
from app.phash import hamming, phash


def meta(cid: str = "base1-4", name_de: str = "Glurak", name_en: str = "Charizard", number: str = "4") -> CardMeta:
    return CardMeta(
        id=cid, name_de=name_de, name_en=name_en, number=number, set_id="base1",
        set_name="Basis-Set", has_image=True,
    )


# --- OCR-Helfer -------------------------------------------------------------

def test_normalize_digits_tolerant():
    assert normalize_digits("O1l") == "011"
    assert digits_only("S5") == "55"


def test_is_numeric_accepts_numbers_only():
    assert is_numeric("120")
    assert is_numeric("4 / 102")
    assert is_numeric("5/6")


def test_is_numeric_rejects_words():
    # Regression: Buchstaben->Ziffern-Map darf Namen nicht als Zahl verkaufen
    assert not is_numeric("Genesect")      # G->6, S->5
    assert not is_numeric("BASIC")         # B->8, S->5, I->1
    assert not is_numeric("Creatures/GAME")
    assert not is_numeric("HP")
    assert not is_numeric("Illus. Mitsuhiro")


# --- Score-Funktionen -------------------------------------------------------

def test_phash_score_monotonic():
    # PHASH_DIST_ZERO = 16 (kalibriert)
    assert phash_score(0) == 1.0
    assert phash_score(8) == 0.5
    assert phash_score(64) == 0.0
    assert phash_score(4) > phash_score(12)


def test_emb_score_bounds():
    # EMB_LOWER = 0.72, EMB_UPPER = 0.92 (kalibriert)
    assert emb_score(0.99) == 1.0
    assert emb_score(0.1) == 0.0
    assert abs(emb_score(0.82) - 0.5) < 1e-9
    assert 0 < emb_score(0.90) < 1


def test_name_similarity_fuzzy():
    assert name_similarity("Glurak", "Glurak") == 1.0
    assert name_similarity("Glurak", "Glurak V") > 0.6   # Teilstring
    assert name_similarity("Genesect", "Genesect") == 1.0
    assert name_similarity("Glurak", "Taubsi") < 0.4


def test_number_match_tolerances():
    assert number_match("4", "4") == 1.0
    assert number_match("04", "4") == 1.0
    assert number_match("SWSH031", "SWSH031") == 1.0
    assert number_match("31", "SWSH031") == 0.6          # Teilstring
    assert number_match("7", "4") == 0.0
    assert number_match(None, "4") == -1.0               # OCR fehlt -> neutral


# --- Fusion + Entscheidung --------------------------------------------------

def test_fuse_vision_only():
    cs = CandidateScore(card_id="x", meta=meta(), phash_dist=0, emb_sim=0.95)
    v = fuse(cs)
    assert v > 0.9


def test_fuse_ocr_boosts():
    base = CandidateScore(card_id="x", meta=meta(), phash_dist=10, emb_sim=0.70)
    fuse(base)
    boosted = CandidateScore(
        card_id="x", meta=meta(), phash_dist=10, emb_sim=0.70,
        ocr_number=1.0, ocr_name=1.0,
    )
    fuse(boosted)
    assert boosted.final > base.final


def test_fuse_bad_ocr_lowers_score():
    cs = CandidateScore(
        card_id="x", meta=meta(), phash_dist=10, emb_sim=0.70,
        ocr_number=0.0, ocr_name=0.1,
    )
    fuse(cs)
    plain = CandidateScore(card_id="x", meta=meta(), phash_dist=10, emb_sim=0.70)
    fuse(plain)
    assert cs.final < plain.final


def test_ocr_veto_blocks_auto():
    # OCR widerspricht ausdruecklich (Nummer falsch) -> KEIN Auto, auch bei
    # sehr starker Vision (Nie-wieder-stillschweigend-falsch-Regel)
    cs = CandidateScore(card_id="x", meta=meta(), phash_dist=1, emb_sim=0.95,
                        ocr_number=0.0, ocr_name=0.0)
    fuse(cs)
    cs2 = CandidateScore(card_id="y", meta=meta(cid="base1-5", number="5"),
                         phash_dist=20, emb_sim=0.60)
    fuse(cs2)
    ranked = sorted([cs, cs2], key=lambda c: -c.final)
    auto, reason = decide(ranked)
    assert auto is False
    assert "widerspricht" in reason


def test_auto_when_vision_agrees_and_ocr_unknown():
    # Beide Vision-Quellen einig, OCR ohne Aussage -> Auto erlaubt
    cs = CandidateScore(card_id="x", meta=meta(), phash_dist=2, emb_sim=0.93)
    fuse(cs)
    cs2 = CandidateScore(card_id="y", meta=meta(cid="base1-5", number="5"),
                         phash_dist=18, emb_sim=0.65)
    fuse(cs2)
    ranked = sorted([cs, cs2], key=lambda c: -c.final)
    auto, reason = decide(ranked)
    assert auto is True
    assert "pHash+Embedding" in reason


def test_decide_kein_auto_bei_kleinem_margin():
    cs = CandidateScore(card_id="x", meta=meta(), phash_dist=5, emb_sim=0.85)
    fuse(cs)
    cs2 = CandidateScore(card_id="y", meta=meta(cid="base1-5"), phash_dist=6, emb_sim=0.84)
    fuse(cs2)
    ranked = sorted([cs, cs2], key=lambda c: -c.final)
    auto, reason = decide(ranked)
    assert auto is False
    assert "Vorsprung" in reason or "niedrig" in reason


def test_recognize_end_to_end_ranking():
    catalog = {
        "base1-4": meta(),
        "base1-5": meta(cid="base1-5", number="5", name_de="Glurak", name_en="Charizard"),
    }
    res = recognize(
        phash_hits=[("base1-4", 2), ("base1-5", 18)],
        emb_hits=[("base1-4", 0.92), ("base1-5", 0.62)],
        catalog_hits=catalog,
        ocr_name="Charizard",
        ocr_number="4",
        quality={"ok": True},
    )
    assert res.candidates[0].card_id == "base1-4"
    assert res.candidates[0].final > res.candidates[1].final
    assert res.auto_save is True


def test_recognize_ohne_treffer():
    res = recognize(
        phash_hits=[], emb_hits=[], catalog_hits={},
        ocr_name=None, ocr_number=None, quality={},
    )
    assert res.candidates == []
    assert res.auto_save is False


# --- pHash ------------------------------------------------------------------

def test_phash_deterministic_and_discriminative():
    rng = np.random.default_rng(0)
    a = rng.integers(0, 255, (224, 224, 3), dtype=np.uint8)
    b = rng.integers(0, 255, (224, 224, 3), dtype=np.uint8)
    assert phash(a) == phash(a)
    assert hamming(phash(a), phash(a)) == 0
    # sehr unterschiedliche Bilder -> grosse Distanz
    assert hamming(phash(a), phash(b)) > 10


def test_phash_scale_invariant():
    import cv2

    # Strukturiertes Bild (nicht Rauschen - Rauschen ist skalenungebunden)
    y, x = np.mgrid[0:300, 0:220]
    a = np.zeros((300, 220, 3), np.uint8)
    a[..., 0] = (x * 1.1 + y * 0.4) % 255
    a[..., 1] = ((x // 7) * 13 + y) % 255
    a[..., 2] = (np.sin(x / 12.0) * 100 + 128).astype(np.uint8)
    cv2.circle(a, (110, 150), 60, (240, 80, 30), -1)
    cv2.rectangle(a, (30, 30), (190, 90), (20, 220, 240), -1)

    small = cv2.resize(a, (150, 110))
    big = cv2.resize(a, (600, 440))
    assert hamming(phash(a), phash(small)) <= 6
    assert hamming(phash(a), phash(big)) <= 6
