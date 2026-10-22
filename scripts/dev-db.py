#!/usr/bin/env python3
"""Embedded PostgreSQL für lokale Entwicklung (ohne Docker/Root).

Nutzt die mit `pgserver` (in apps/rec/.venv) ausgelieferten PostgreSQL-Binaries.
Startet den Server auf TCP 127.0.0.1:5433 und legt die App-Datenbank an.

Start:   apps/rec/.venv/bin/python scripts/dev-db.py
Stoppen: Ctrl+C (sauberer Stop) oder erneutes Ausführen startet neu.
"""

import os
import pathlib
import signal
import subprocess
import sys
import time

VENV_SITE = pathlib.Path(__file__).resolve().parent.parent / "apps" / "rec" / ".venv" / "lib" / "python3.11" / "site-packages"
PGBIN = VENV_SITE / "pgserver" / "pginstall" / "bin"
DATADIR = pathlib.Path.home() / ".pgdata" / "pcs"
HOST = "127.0.0.1"
PORT = 5433
DB_NAME = os.environ.get("POSTGRES_DB", "pcs_db")
DB_USER = os.environ.get("POSTGRES_USER", "postgres")


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run([str(a) for a in args], check=check, capture_output=True, text=True)


def is_up() -> bool:
    r = run(PGBIN / "pg_isready", "-h", HOST, "-p", str(PORT), "-U", DB_USER, check=False)
    return r.returncode == 0


def ensure_db() -> None:
    r = run(
        PGBIN / "psql",
        "-h", HOST, "-p", str(PORT), "-U", DB_USER, "-d", "postgres",
        "-tc", "SELECT 1 FROM pg_database WHERE datname = %s" % f"'{DB_NAME}'",
        check=False,
    )
    if r.stdout.strip() != "1":
        run(PGBIN / "createdb", "-h", HOST, "-p", str(PORT), "-U", DB_USER, DB_NAME)
        print(f"Datenbank {DB_NAME} angelegt.")
    run(
        PGBIN / "psql",
        "-h", HOST, "-p", str(PORT), "-U", DB_USER, "-d", DB_NAME,
        "-c", "CREATE EXTENSION IF NOT EXISTS vector;",
        check=False,
    )


def main() -> None:
    DATADIR.mkdir(parents=True, exist_ok=True)
    if not (DATADIR / "PG_VERSION").exists():
        run(
            PGBIN / "initdb",
            "-D", DATADIR, "-U", DB_USER, "-A", "trust",
        )
        print(f"Cluster initialisiert in {DATADIR}")

    if not is_up():
        run(
            PGBIN / "pg_ctl",
            "-D", DATADIR,
            "-l", str(DATADIR / "server.log"),
            "-o", f"-h {HOST} -p {PORT} -k {DATADIR}",
            "start",
        )
        for _ in range(50):
            if is_up():
                break
            time.sleep(0.2)
        else:
            print("Server startete nicht. Log:", (DATADIR / "server.log").read_text()[-2000:])
            sys.exit(1)
    print(f"PostgreSQL läuft auf {HOST}:{PORT} (Daten: {DATADIR})")

    ensure_db()
    print(f"App-Datenbank: {DB_NAME} | DATABASE_URL=postgresql://{DB_USER}@{HOST}:{PORT}/{DB_NAME}")
    print("Server läuft. Beenden mit Ctrl+C.")

    stop = False

    def handler(signum, frame):  # noqa: ARG001
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)
    while not stop:
        time.sleep(1)

    print("Stoppe Server …")
    run(PGBIN / "pg_ctl", "-D", DATADIR, "-m", "fast", "stop", check=False)


if __name__ == "__main__":
    main()
