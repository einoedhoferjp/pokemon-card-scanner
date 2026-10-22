import os
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
REC_DIR = APP_DIR.parent
ROOT_DIR = REC_DIR.parent

load_dotenv(ROOT_DIR / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
REF_CACHE_DIR = Path(os.environ.get("REF_CACHE_DIR", ROOT_DIR / "data/ref_cache"))
UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR", ROOT_DIR / "data/uploads"))
INDEX_DIR = ROOT_DIR / "data" / "index"

# Kartenformat 63 x 88 mm (Standard-Pokémon-Karte), Querformat ist die Karte
CARD_MM = (63.0, 88.0)
# Ziel-Auflösung für den Warp: Pixel pro mm (Kante ~700 px breit → ~11 px/mm)
WARP_PX_PER_MM = 11.0

# Erkennungs-Schwellwerte
QUALITY_MIN_SHARPNESS = 60.0  # Laplace-Varianz (grayscale, 16-Bit-Interpretation)
QUALITY_MIN_BRIGHTNESS = 45.0
QUALITY_MAX_BRIGHTNESS = 225.0
QUALITY_MIN_GLARE_RATIO = 0.0  # max. Anteil gesättigter Pixel in der Kartenfläche

PHASH_MAX_DISTANCE = 10  # 64 Bit: max. erlaubte Hamming-Distanz für Kandidaten
CONSENSUS_AUTO_ACCEPT = 0.72  # ab hier Auto-Übernahme, wenn Konsens aus ≥2 Verfahren
CONSENSUS_CONFIRM = 0.45  # ab hier Top-3-Vorschlag zeigen
TOP_K = 3

# Embeddings
EMBED_MODEL_NAME = os.environ.get("EMBED_MODEL_NAME", "dinov2-small")
EMBED_MODEL_PATH = INDEX_DIR / "dinov2-small.onnx"
EMBED_CACHE_PATH = INDEX_DIR / "embeddings.npz"
PHASH_CACHE_PATH = INDEX_DIR / "phash.npz"


def ensure_dirs() -> None:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
