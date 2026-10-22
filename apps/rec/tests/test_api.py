"""API-Tests für /recognize und /health (Recognizer gemockt, schnell)."""

from __future__ import annotations

import numpy as np
import cv2
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.catalog import CardMeta
from app.matcher import CandidateScore, RecognizeResult


@pytest.fixture()
def client(monkeypatch):
    class FakeRecognizer:
        phash_index = type("I", (), {"size": 17085})()
        emb_index = type("I", (), {"size": 17085})()
        catalog = type("C", (), {"size": 20232})()

        def recognize_bytes(self, data: bytes) -> RecognizeResult:
            meta = CardMeta(
                id="base1-4", name_de="Glurak", name_en="Charizard",
                number="4", set_id="base1", set_name="Basis-Set", has_image=True,
            )
            cs = CandidateScore(card_id="base1-4", meta=meta, phash_dist=1, emb_sim=0.95)
            cs.final = 0.96
            return RecognizeResult(
                candidates=[cs], auto_save=True, reason="Konsens: OCR bestaetigt",
                ocr_name="Charizard", ocr_number="4", ocr_total="102",
                quality={"ok": True},
            )

    monkeypatch.setattr(main, "_recognizer", FakeRecognizer())
    return TestClient(main.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["cards"] == 20232


def test_recognize_ok(client):
    # kleines gültiges JPEG erzeugen
    img = np.full((88, 63, 3), 200, np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    r = client.post(
        "/recognize",
        files={"image": ("scan.jpg", buf.tobytes(), "image/jpeg")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["autoSave"] is True
    assert body["candidates"][0]["cardId"] == "base1-4"
    assert body["candidates"][0]["nameEn"] == "Charizard"
    assert body["ocrNumber"] == "4"
    assert "elapsedMs" in body


def test_recognize_rejects_non_image(client):
    r = client.post(
        "/recognize",
        files={"image": ("scan.txt", b"kein bild", "text/plain")},
    )
    assert r.status_code == 415


def test_recognize_rejects_empty(client):
    r = client.post(
        "/recognize",
        files={"image": ("scan.jpg", b"", "image/jpeg")},
    )
    assert r.status_code == 400


def test_recognize_rejects_too_large(client):
    r = client.post(
        "/recognize",
        files={"image": ("scan.jpg", b"x" * (16 * 1024 * 1024), "image/jpeg")},
    )
    assert r.status_code == 413
