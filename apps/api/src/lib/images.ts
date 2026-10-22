// Bild-Handling: Validierung, EXIF-Entfernung, Referenzbilder.
//
// DSGVO: Hochgeladene Fotos werden neu kodiert (sharp ohne withMetadata),
// dadurch verschwinden EXIF/GPS/Zeitstempel des Handys.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { RecError } from "./rec.js";

export const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "../../data/uploads");
export const REF_CACHE_DIR =
  process.env.REF_CACHE_DIR ?? path.resolve(process.cwd(), "../../data/ref_cache");

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 2200;

export type NormalizedImage = {
  /** Neu kodiertes JPEG ohne Metadaten. */
  buffer: Buffer;
  width: number;
  height: number;
};

/** Prueft Magic Bytes (JPEG/PNG/WebP) - verhindert HTML-Fehlerseiten als "Bild". */
export function sniffImageType(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** Validiert das Upload, entfernt Metadaten und skaliert auf max. 2200 px. */
export async function normalizeUpload(buf: Buffer): Promise<NormalizedImage> {
  if (buf.length === 0) throw new RecError("Leere Datei");
  if (buf.length > MAX_UPLOAD_BYTES) throw new RecError("Bild zu gross (max 15 MB)");
  if (!sniffImageType(buf)) throw new RecError("Kein gueltiges Bild (JPEG/PNG/WebP erwartet)");

  try {
    const out = await sharp(buf, {
      failOn: "error",
      // "Bombe" verhindern: maximal ~40 Megapixel (statt der sharp-Voreinstellung
      // von rund 268 Mio). Ein 15-MB-Bild kann sonst den Speicher der Instanz
      // fuellen, bevor es abgelehnt wird.
      limitInputPixels: 40_000_000,
    })
      .rotate() // EXIF-Orientierung anwenden, dann Metadaten verwerfen
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: out.data, width: out.info.width, height: out.info.height };
  } catch (e) {
    // Interne sharp-Details bleiben im Log (siehe Route), nach aussen nur der
    // eigene, kurze Text.
    throw new RecError("Bild konnte nicht verarbeitet werden (JPEG, PNG oder WebP)", undefined, {
      cause: e,
    });
  }
}

export async function saveScanImage(scanId: string, jpeg: Buffer): Promise<string> {
  const dir = path.join(UPLOADS_DIR, "scans");
  await fs.mkdir(dir, { recursive: true });
  const rel = path.join("scans", `${scanId}.jpg`);
  await fs.writeFile(path.join(UPLOADS_DIR, rel), jpeg);
  return rel;
}

export async function deleteScanImage(relPath: string | null): Promise<void> {
  if (!relPath) return;
  // Gleiche Pfad-Pruefung wie beim Ausliefern: ein fremder oder manipulierter
  // Pfad in der Datenbank darf keine Datei ausserhalb des Upload-Ordners loeschen.
  const full = scanImagePath(relPath);
  if (!full) return;
  await fs.rm(full, { force: true });
}

/** Pfad zum gespeicherten Scan-Foto (inkl. Pfad-Traversal-Schutz). */
export function scanImagePath(relPath: string): string | null {
  const base = path.resolve(UPLOADS_DIR);
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

/** Pfad zum Referenzbild einer Karte (data/ref_cache/cards/<id>.jpg). */
export function referenceImagePath(tcgdexId: string): string {
  const safe = tcgdexId.replace(/[^a-zA-Z0-9._-]/g, "");
  return path.join(REF_CACHE_DIR, "cards", `${safe}.jpg`);
}

/** Liest ein Referenzbild und verifiziert, dass es wirklich ein Bild ist. */
export async function readReferenceImage(tcgdexId: string): Promise<Buffer | null> {
  const file = referenceImagePath(tcgdexId);
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return null;
  }
  if (!sniffImageType(buf)) return null; // z. B. frueher gecachte HTML-Fehlerseite
  return buf;
}
