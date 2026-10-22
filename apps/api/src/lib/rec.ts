// Client fuer den Erkennungs-Service (FastAPI, apps/rec).

import type { RecognitionCandidate, RecResponse } from "@shared/types";
import { errorMessage } from "./errors.js";

const REC_URL = process.env.REC_URL ?? "http://localhost:8000";
const TIMEOUT_MS = Number(process.env.REC_TIMEOUT_MS ?? 30000);

export type RecognizeResult = {
  candidates: RecognitionCandidate[];
  autoSave: boolean;
  reason: string;
  ocrName: string | null;
  ocrNumber: string | null;
  quality: RecResponse["quality"];
  elapsedMs: number;
};

export class RecError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RecError";
  }
}

/** Schickt ein Bild (JPEG-Bytes) an /recognize und liefert die Kandidaten. */
export async function recognizeImage(
  jpeg: Buffer,
  filename = "scan.jpg",
): Promise<RecognizeResult> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), filename);

  let res: Response;
  try {
    res = await fetch(`${REC_URL}/recognize`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new RecError(`Erkennungs-Service nicht erreichbar: ${errorMessage(e)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RecError(
      `Erkennung fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as RecResponse;
  return {
    candidates: data.candidates ?? [],
    autoSave: Boolean(data.autoSave),
    reason: data.reason ?? "",
    ocrName: data.ocrName ?? null,
    ocrNumber: data.ocrNumber ?? null,
    quality: data.quality ?? {},
    elapsedMs: data.elapsedMs ?? 0,
  };
}

export async function recHealth(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${REC_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
