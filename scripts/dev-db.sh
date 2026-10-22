#!/usr/bin/env bash
# Startet die lokale Dev-Datenbank (embedded PostgreSQL, kein Docker/Root).
set -euo pipefail
cd "$(dirname "$0")/.."
exec apps/rec/.venv/bin/python scripts/dev-db.py
