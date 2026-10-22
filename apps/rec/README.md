# PCS Erkennungs-Service (rec)

FastAPI-Service, der Kartenfotos erkennt: **pHash + DINOv2-Embeddings + OCR** werden
zu einem Konsens fusioniert. Nur bei ausreichender Übereinstimmung mehrerer Methoden
wird `autoSave=true` gesetzt – eine Karte wird **nie stillschweigend falsch gespeichert**.

## Pipeline

```
Foto → Qualität (scharf/belichtet/spiegelarm)
     → Detektion + Perspektivenkorrektur (63×88 mm, 630×880 px)
     ├─ pHash (64-Bit DCT)      → Index: data/index/phash.npz      (17.085 Bilder)
     ├─ DINOv2-small (ONNX, CLS, 384-d, L2) → data/index/embeddings.npz
     └─ PaddleOCR (Namens- + Nummernstreifen) → Name, "n/m"
              ↓
     Konsens-Fusion (app/matcher.py) → Top-3-Kandidaten + Auto-Entscheidung
```

### Auto-Entscheidung (`app/matcher.py`)

Gewichte: `final = 0.65·Vision + 0.20·OCR-Nummer + 0.15·OCR-Name`
(Vision = `0.55·Embedding + 0.45·pHash`, fehlende Quellen werden umverteilt).

`autoSave` nur wenn **alle** zutreffen:

1. `final ≥ 0.85` **und** Vorsprung zu Platz 2 ≥ `0.08`,
2. **mindestens zwei unabhängige Methoden** bestätigen:
   - OCR (Nummer exakt + Name ähnlich), **oder**
   - pHash (Distanz ≤ 8) **und** Embedding (Score ≥ 0.5) einig,
3. **kein OCR-Veto**: OCR-Nummer widerspricht (< 0.5) → kein Auto, auch bei starker
   Vision; dasselbe für den Namen, falls nur der Name als OCR-Evidence vorliegt.

Schwellwerte sind in `app/matcher.py` als Konstanten dokumentiert und wurden mit
`scripts/calibrate.py` aus Daten kalibriert (siehe unten).

## Endpunkte

| Methode | Pfad         | Beschreibung                                                                   |
| ------- | ------------ | ------------------------------------------------------------------------------ |
| GET     | `/health`    | Status + Indexzähler                                                           |
| POST    | `/recognize` | Multipart `image` (≤ 15 MB, `image/*`) → Top-3, `autoSave`, `reason`, Qualität |

## Lokal ausführen

```bash
cd apps/rec
source .venv/bin/activate        # Python 3.11, siehe requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Voraussetzungen: PostgreSQL läuft (`scripts/dev-db.py`), `.env` im Repo-Root
(`DATABASE_URL`, `REF_CACHE_DIR`, `INDEX_DIR`).

Im Container (Deployment) heißen die Pfade `/app/data/index` und
`/app/data/ref_cache` und kommen als Volume aus `./data`; die PaddleOCR-Modelle
sind im Image enthalten (`apps/rec/Dockerfile`). Der Dienst steckt im Compose-Stack
hinter der API und ist von außen nicht erreichbar – siehe
[`DEPLOYMENT.md`](../../DEPLOYMENT.md).

## Indizes aufbauen

```bash
python -m scripts.build_phash          # ~3 min  → data/index/phash.npz
python -m scripts.build_embeddings     # ~60 min → data/index/embeddings.npz
```

Beide sind resumierbar? pHash ja (Datei wird komplett neu geschrieben, schnell),
Embeddings: bei Unterbrechung einfach erneut starten (dauert leider voll).

## Evaluation & Kalibrierung

```bash
python -m scripts.calibrate --samples 150   # Verteilungen + Schwellenvorschläge
python -m scripts.evaluate --samples 300 --verbose    # simulierte Fotos
python -m scripts.evaluate --real /pfad/zu/fotos       # echte Fotos, Dateiname = tcgdex_id
python -m scripts.eval_phash --samples 200            # nur pHash-Retrieval
```

`evaluate` berichtet Top-1/Top-3, Auto-Rate, **Falsch-Auto-Rate (Ziel < 0,5 %)**,
Detektionsrate und Latenz, und exitet mit Code 2, wenn das Ziel verfehlt wird.

### Ergebnisse (deterministischer Lauf, 300 simulierte Fotos, seed=42)

| Metrik          | Ergebnis                          | Ziel          |
| --------------- | --------------------------------- | ------------- |
| Kartendetektion | 273/300 (91,0 %)                  | –             |
| **Top-1**       | **262/300 (87,3 %)**              | –             |
| **Top-3**       | **272/300 (90,7 %)**              | –             |
| Auto-Rate       | 123/300 (41,0 %)                  | –             |
| **Falsch-Auto** | **0/123 (0,00 %)**                | **< 0,5 %** ✓ |
| Latenz (CPU)    | p50 1,4 s · p95 2,1 s · max 2,9 s | –             |

Vergleich ohne Embeddings (pHash+OCR, gleiche Fotos): Top-1 ≈ 69 %, Top-3 ≈ 71 % –
**die Embeddings sind der Haupttreiber** (+18 Prozentpunkte Top-1).

Kalibrierung (`scripts/calibrate.py`, 150 Fotos):

- pHash: wahr p50=4 / p95=8,8 · fremd p50=12 / p95=16 → `PHASH_DIST_ZERO = 16`
- DINOv2: wahr p50=0,908 · fremd p50=0,742 (Tails überlappen durch Detektionsfehler,
  deshalb medianische Wahl) → `EMB_LOWER = 0,72`, `EMB_UPPER = 0,92`
- A/B-Test Multi-Crop-Fallback bei Detektionsfehlern: **keine Messänderung**
  (identische Top-1/Top-3/Auto-Zahlen) → default aus (`use_fallback=False`)

Wichtig: `evaluate` erzeugt die simulierten Fotos prozessunabhängig deterministisch
(`case_seed` via md5) – ohne das schwanken die Zahlen zwischen Läufen.

### Testdatenlage

- Aktuell: **simulierte Fotos** aus den Referenzbildern (Rotation ±7°, Skalierung,
  Untergrund, Helligkeit) – Reproduzierbar über `--seed`.
- Echte Handyfotos: Ordner mit `tcgdex_id.jpg` an `--real` übergeben (wird nachgereicht,
  sobald ein manuell gescanntes Set vorliegt).

## Bekannte Schwächen

1. **3.147 Karten ohne Referenzbild** (Japan-Setzahlen A1/A2/A3, me02.5, exu): für sie
   existiert weder pHash- noch Embedding-Eintrag. Erkennung nur über OCR/Nummer –
   Absicht ist, sie in der Evaluation gesondert auszuweisen.
2. **pHash allein ist nicht diskriminativ genug** (17k Karteikarten, ähnliche Motive):
   Top-1 ohne Embeddings ~69 % – Embeddings sind der Haupttreiber.
3. **OCR dauert ~1,5–2 s** (CPU) und ist die Latenzdomäne; pHash+Embedding sind < 300 ms.
4. **Kartensprache ≠ DB-Sprache**: die Bilder von pokemontcg.io sind englisch, die
   Katalog-Namen liegen deutsch **und** englisch vor (`name_de`/`name_en`) – beide werden
   für den OCR-Namen-Vergleich herangezogen.
5. **Simulierte Fotos überschätzen** die Robustheit gegenüber echten Bedingungen
   (Reflexe, Finger, unscharf) – deshalb: Qualitätsgate (`preprocess.py`) und
   Eval-Zweig `--real`.

## Tests

```bash
cd apps/rec && python -m pytest tests/ -q
```

Unit-Tests (Fusion, OCR-Helfer, pHash) + API-Tests (`/health`, `/recognize`,
Validierung) – 22 Tests, ohne Modelle/Ladung (Recognizer wird gemockt).
