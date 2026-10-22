"""OCR auf einer warpten Karte: Kartname und Kartennummer extrahieren.

Nutzung:
    ocr = CardOCR()
    result = ocr.read(warped_bgr)
    result.name      -> z. B. "Glurak"  (oder None)
    result.number    -> z. B. "4"       (Teil vor dem Strich, oder None)
    result.total     -> z. B. "102"     (Teil nach dem Strich, oder None)
    result.lines     -> alle Erkennungen mit Box und Konfidenz

Toleranz: O/0, I/1/l/1, abtrennende Leerzeichen ("4 / 1 02" -> 4/102).
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field

import cv2
import numpy as np

# Karten-Layout (Anteile der Kartenhöhe)
NAME_BAND = (0.02, 0.14)     # Name oben links
NUMBER_BAND = (0.88, 1.00)   # Nummer unten (rechts)

# OCR-Fehlerklasse: Ziffern, die Buchstaben gleichen
DIGIT_MAP = str.maketrans({
    "O": "0", "o": "0", "D": "0", "Q": "0",
    "I": "1", "l": "1", "|": "1", "i": "1",
    "Z": "2", "z": "2",
    "S": "5", "s": "5",
    "B": "8",
    "G": "6",
})

NUMBER_RE = re.compile(r"(\d{1,4})\s*[/|:]\s*(\d{1,4})")
# Ziffern ODER ziffernnahe OCR-Buchstaben (O->0, I/l->1, S->5 ...) als Rohteil
DIGITLIKE_RE = re.compile(r"([0-9OoIl|SsBZGzDQ]{1,4})\s*[/|:]\s*([0-9OoIl|SsBZGzDQ]{1,4})")
DIGITS_ONLY_RE = re.compile(r"^\d{1,4}$")


def normalize_digits(text: str) -> str:
    return text.translate(DIGIT_MAP)


def digits_only(text: str) -> str:
    return re.sub(r"[^0-9]", "", normalize_digits(text))


def is_numeric(text: str) -> bool:
    """True, wenn die Zeile im Kern aus Ziffern besteht (z. B. "120", "4 / 102").

    Wichtig: `digits_only` uebersetzt auch Buchstaben (S->5, G->6) und wuerde
    damit Namen wie "Genesect" als numerisch verkaufen - daher Anteil pruefen.
    """
    stripped = re.sub(r"[\s/|:.,'\-]+", "", text)
    if not stripped or not re.search(r"\d", stripped):
        return False
    alnum = re.sub(r"[^0-9A-Za-z]", "", stripped)
    if not alnum:
        return False
    digits = sum(c.isdigit() for c in alnum)
    return digits / len(alnum) >= 0.8


@dataclass
class OcrLine:
    text: str
    conf: float
    box: list[list[float]]  # 4 Punkte

    @property
    def cy(self) -> float:
        return sum(p[1] for p in self.box) / 4

    @property
    def cx(self) -> float:
        return sum(p[0] for p in self.box) / 4


@dataclass
class OcrResult:
    lines: list[OcrLine] = field(default_factory=list)
    name: str | None = None
    number: str | None = None
    total: str | None = None
    number_raw: str | None = None

    @property
    def has_number(self) -> bool:
        return self.number is not None


class CardOCR:
    """Singleton-nah: ein PaddleOCR-Modell pro Prozess (teuer zu laden)."""

    _instance: "CardOCR | None" = None
    _lock = threading.Lock()

    def __new__(cls) -> "CardOCR":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._init_model()
        return cls._instance

    def _init_model(self) -> None:
        from paddleocr import PaddleOCR  # lazy: Modellgewicht erst beim ersten Use

        self._ocr = PaddleOCR(
            use_angle_cls=True, lang="en", use_gpu=False, show_log=False, det_db_thresh=0.3
        )

    def read(self, image: np.ndarray, cls: bool = True) -> OcrResult:
        """OCR nur auf zwei Streifen: Name (oben links) + Nummer (unten rechts).

        Zweimal kleinerer Ausschnitt ist deutlich schneller als die volle
        Karte und stört weniger durch Fließtext.
        """
        h, w = image.shape[:2]

        name_roi = image[int(h * 0.00) : int(h * 0.17), 0 : int(w * 0.80)]
        num_roi = image[int(h * 0.84) : h, 0:w]

        name_lines = self._run(name_roi) if name_roi.size else []
        num_lines = self._run(num_roi) if num_roi.size else []

        # Koordinaten auf Kartenmaßstab zurückrechnen (für Debug/Bänder)
        for l in num_lines:
            for p in l.box:
                p[1] += h * 0.84

        all_lines = name_lines + num_lines
        out = OcrResult(lines=all_lines)
        out.number, out.total, out.number_raw = self._find_number(all_lines, h, w)
        out.name = self._find_name(name_lines, h, w)
        return out

    def _run(self, roi: np.ndarray) -> list[OcrLine]:
        if roi.shape[0] < 8 or roi.shape[1] < 8:
            return []
        res = self._ocr.ocr(roi, cls=True)
        lines: list[OcrLine] = []
        for entry in (res[0] or []):
            box, (text, conf) = entry[0], entry[1]
            lines.append(OcrLine(text=str(text).strip(), conf=float(conf), box=box))
        return [l for l in lines if l.text]

    def _find_number(
        self, lines: list[OcrLine], h: int, w: int
    ) -> tuple[str | None, str | None, str | None]:
        # 1) "n/m"-Muster - aber nur in Zeilen, die selbst ziffernlastig sind,
        #    sonst erfindet normalize_digits Nummern aus "Creatures/GAME".
        candidates: list[tuple[float, str, str, str]] = []
        for l in lines:
            if not is_numeric(l.text):
                continue
            for m in DIGITLIKE_RE.finditer(l.text):
                raw_num, raw_total = m.group(1), m.group(2)
                num = normalize_digits(raw_num)
                total = normalize_digits(raw_total)
                if not (num.isdigit() and total.isdigit()):
                    continue
                score = l.conf
                if l.cy > h * 0.7:
                    score += 0.5
                if "/" in l.text or "/" in m.group(0):
                    score += 0.3
                candidates.append((score, num, total, m.group(0)))
        if candidates:
            candidates.sort(key=lambda t: -t[0])
            _, num, total, raw = candidates[0]
            return str(int(num)), str(int(total)), raw

        # 2) Nur Ziffern im Nummernband unten (Karte ohne /total)
        band = [
            l
            for l in lines
            if l.cy > h * NUMBER_BAND[0] and is_numeric(l.text)
        ]
        if band:
            band.sort(key=lambda l: -l.conf)
            d = digits_only(band[0].text)
            if d:
                return str(int(d)), None, band[0].text
        return None, None, None

    def _find_name(self, lines: list[OcrLine], h: int, w: int) -> str | None:
        """Name aus dem oberen Streifen (ROI-interne Koordinaten).

        HP-Zahlen sitzen oben rechts, der Name oben links - reine Ziffern
        und rechtsbuendige Zeilen werden verworfen.
        """
        roi_w = w * 0.80
        labels = {"hp", "hp.", "hp:", "lv", "lv."}
        usable = [
            l
            for l in lines
            if l.conf >= 0.5
            and not is_numeric(l.text)
            and l.text.strip().lower() not in labels
        ]
        candidates = [l for l in usable if l.cx <= roi_w * 0.62]
        if not candidates:
            candidates = usable
        if not candidates:
            return None
        candidates.sort(key=lambda l: (-l.conf, l.cx))
        text = candidates[0].text
        # Typische OCR-Reste am Namensende (HP-Zahl) abschneiden
        text = re.sub(r"\s+\d{2,4}$", "", text).strip()
        return text or None
