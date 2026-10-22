# Erkennungs-Service (FastAPI + PaddleOCR + DINOv2/ONNX) fuer den Betrieb.
#
# Die grossen, veraenderlichen Daten liegen NICHT im Image, sondern kommen per
# Volume: data/index (phash.npz, embeddings.npz) und data/ref_cache (Referenzbilder).
# Ins Image kommen: Code, requirements und das DINOv2-Modell (85 MB).

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/apps/rec

# libgl1/libglib2: OpenCV, libgomp1: onnxruntime, Rest: Paddle/OpenCV-Laufzeit
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/apps/rec

COPY apps/rec/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# OCR-Modelle (PaddleOCR det/rec/cls, zusammen ~15 MB) beim Bauen herunterladen,
# damit der Container auch ohne Internet startet.
RUN python -c "\
from paddleocr import PaddleOCR; \
PaddleOCR(use_angle_cls=True, lang='en', use_gpu=False, show_log=False, det_db_thresh=0.3); \
print('PaddleOCR-Modelle geladen')" \
    && rm -rf /root/.cache

COPY apps/rec /app/apps/rec

# Nur Lesen: Index und Referenzbilder liegen im Volume ./data
VOLUME ["/app/data"]

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
