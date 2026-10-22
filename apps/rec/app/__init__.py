"""PCS Erkennungs-Service (App-Paket)."""

from __future__ import annotations

import pathlib

# Lokale Entwicklung: .env des Repos laden (in Docker via env_file gesetzt)
try:
    from dotenv import load_dotenv

    _env = pathlib.Path(__file__).resolve().parents[3] / ".env"
    if _env.exists():
        load_dotenv(_env, override=False)
except Exception:  # noqa: BLE001
    pass
