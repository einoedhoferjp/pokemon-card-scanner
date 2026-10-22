"""Konvertiert die Indizes in das pickle-freie Format.

Alt:  data/index/phash.npz      (hashes + ids als Objekt-Array -> Pickle noetig)
Neu:  data/index/phash.npz      (nur Zahlen)
      data/index/phash.ids.json  (Kartennummern)

Warum: `np.load(..., allow_pickle=True)` fuehrt bei einem manipulierten Index
Code aus (CWE-502). Das neue Format laesst sich mit `allow_pickle=False`
laden. Der Index laesst sich danach unveraendert weiterverwenden - es wird
nichts neu berechnet.

Aufruf (aus apps/rec):
    python -m scripts.migrate_index_format

Das Skript ist ein Offline-Werkzeug: es liest das alte Format bewusst einmalig
mit Pickle. Im Betrieb (apps/rec/app) wird nie mit Pickle geladen.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.indexio import ids_path  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
INDEX_DIR = pathlib.Path(os.environ.get("INDEX_DIR", str(REPO_ROOT / "data" / "index")))

TARGETS = ("phash.npz", "embeddings.npz")


def migrate_one(path: pathlib.Path) -> bool:
    ids_file = ids_path(path)
    if ids_file.exists():
        print(f"  {path.name}: bereits im neuen Format - unveraendert")
        return False
    if not path.exists():
        print(f"  {path.name}: nicht vorhanden - uebersprungen")
        return False

    # Altes Format: einmalig mit Pickle lesen (Offline-Werkzeug).
    with np.load(path, allow_pickle=True) as data:
        if "ids" not in data.files:
            print(f"  {path.name}: kein 'ids'-Array - unveraendert")
            return False
        ids = [str(x) for x in data["ids"]]
        arrays = {k: data[k] for k in data.files if k != "ids"}

    tmp = path.with_name(path.stem + ".new.npz")
    np.savez_compressed(tmp, **arrays)
    tmp.replace(path)
    ids_file.write_text(json.dumps(ids, ensure_ascii=False), encoding="utf-8")

    print(f"  {path.name}: {len(ids)} Eintraege -> {path.name} + {ids_file.name}")
    return True


def main() -> None:
    print(f"Index-Verzeichnis: {INDEX_DIR}")
    changed = sum(1 for name in TARGETS if migrate_one(INDEX_DIR / name))
    print("FERTIG" if changed else "Nichts zu tun")


if __name__ == "__main__":
    main()
