"""Speicherformat der Indizes (pHash, Embeddings).

Die Indizes liegen als `.npz` (nur Zahlen) plus `.ids.json` (Kartennummern)
vor. Bewusst getrennt: numpy-Arrays mit Objekt-Typen brauchen `allow_pickle=True`
beim Laden - und Pickle ausfuehren ist eine direkte Codeausfuehrung. Wer den
Index-Ordner manipulieren kann, koennte sonst eigenen Code in den
Erkennungs-Service schmuggeln. Mit der Trennung laesst sich der Index
sicher ohne Pickle lesen (`allow_pickle=False`).

Aeltere Dateien (npz mit Objekt-Array) konvertiert:
    python -m scripts.migrate_index_format
"""

from __future__ import annotations

import json
import pathlib


def ids_path(index_path: str | pathlib.Path) -> pathlib.Path:
    """Zugehoerige JSON-Datei mit den Kartennummern (gleiche Basis, .ids.json)."""
    p = pathlib.Path(index_path)
    return p.with_suffix(".ids.json")


def save_ids(index_path: str | pathlib.Path, ids: list[str]) -> None:
    path = ids_path(index_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ids, ensure_ascii=False), encoding="utf-8")


def load_ids(index_path: str | pathlib.Path) -> list[str]:
    path = ids_path(index_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Kartennummern fehlen: {path} existiert nicht. "
            "Index neu bauen oder mit 'python -m scripts.migrate_index_format' "
            "das alte Format konvertieren."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path} enthaelt keine Liste")
    return [str(x) for x in data]
