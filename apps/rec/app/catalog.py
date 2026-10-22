"""Katalog: Karten-Metadaten aus PostgreSQL in den Speicher laden.

20k Zeilen sind schnell geladen; der Rec-Service hält den Katalog danach
read-only im RAM (Aktualisierung durch Neustart oder /admin/reload).
"""

from __future__ import annotations

import os
import pathlib
import threading
from dataclasses import dataclass

import psycopg


@dataclass(frozen=True)
class CardMeta:
    id: str                 # tcgdex_id, z. B. "base1-4"
    name_de: str | None
    name_en: str | None
    number: str             # localId, z. B. "4" oder "SWSH031"
    set_id: str             # tcgdex set id, z. B. "base1"
    set_name: str | None
    has_image: bool

    @property
    def names(self) -> list[str]:
        return [n for n in (self.name_de, self.name_en) if n]


class Catalog:
    def __init__(self) -> None:
        self.cards: dict[str, CardMeta] = {}
        self._lock = threading.Lock()

    def load(self, dsn: str | None = None) -> int:
        dsn = dsn or os.environ.get("DATABASE_URL", "")
        if not dsn:
            raise RuntimeError("DATABASE_URL fehlt")
        with psycopg.connect(dsn) as con:
            rows = con.execute(
                """
                SELECT c.tcgdex_id, c.name_de, c.name_en, c.number,
                       s.tcgdex_id, s.name_de, c.local_image_path
                FROM cards c JOIN sets s ON s.id = c.set_id
                """
            ).fetchall()
        cards = {
            r[0]: CardMeta(
                id=r[0],
                name_de=r[1],
                name_en=r[2],
                number=str(r[3]),
                set_id=r[4],
                set_name=r[5],
                has_image=r[6] is not None,
            )
            for r in rows
        }
        with self._lock:
            self.cards = cards
        return len(cards)

    def get(self, card_id: str) -> CardMeta | None:
        return self.cards.get(card_id)

    @property
    def size(self) -> int:
        return len(self.cards)


_catalog: Catalog | None = None
_lock = threading.Lock()


def get_catalog() -> Catalog:
    global _catalog
    with _lock:
        if _catalog is None:
            _catalog = Catalog()
            _catalog.load()
        return _catalog


def reload_catalog() -> int:
    global _catalog
    with _lock:
        if _catalog is None:
            _catalog = Catalog()
        return _catalog.load()
