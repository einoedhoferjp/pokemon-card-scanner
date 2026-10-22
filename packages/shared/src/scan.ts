// Scan- und Karten-Typen, die API und Web gemeinsam nutzen.

export type RecognitionCandidate = {
  cardId: string;
  nameDe: string | null;
  nameEn: string | null;
  number: string;
  setId: string;
  setName: string | null;
  /** Gesamt-Score 0..1 (Konsens aus Vision + OCR). */
  final: number;
  phashDist: number | null;
  embSim: number | null;
  ocrNumber: number | null;
  ocrName: number | null;
  hasImage: boolean;
};

export type QualityReport = {
  ok?: boolean;
  problems?: string[];
  cardDetected?: boolean;
  metrics?: Record<string, number>;
};

export type RecognitionInfo = {
  autoSave: boolean;
  reason: string;
  ocrName: string | null;
  ocrNumber: string | null;
  elapsedMs: number;
  quality: QualityReport;
};

/** Rohantwort des rec-Service (snake/camelCase wie von FastAPI geliefert). */
export type RecResponse = {
  candidates: RecognitionCandidate[];
  autoSave: boolean;
  reason: string;
  ocrName: string | null;
  ocrNumber: string | null;
  quality: QualityReport;
  elapsedMs: number;
};

export type ScanStatus = "pending" | "auto" | "confirmed" | "corrected" | "rejected";

export type Scan = {
  id: string;
  status: ScanStatus;
  /** URL des hochgeladenen Fotos (ohne EXIF/GPS). */
  imageUrl: string | null;
  candidates: RecognitionCandidate[];
  chosenCardId: string | null;
  autoCardId: string | null;
  recognition: RecognitionInfo;
  createdAt: string;
  updatedAt: string;
};

export type CardSummary = {
  tcgdexId: string;
  nameDe: string | null;
  nameEn: string | null;
  number: string;
  setId: string;
  setName: string | null;
  rarity: string | null;
  hasImage: boolean;
  imageUrl: string | null;
};

export type ScanFeedbackAction = "confirm" | "correct" | "reject";

export type ScanFeedback = {
  action: ScanFeedbackAction;
  /** Bei "confirm"/"correct" die gewählte Karte (tcgdex_id). */
  cardId?: string;
};
