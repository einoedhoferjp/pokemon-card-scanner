// Unit-Tests für Bild-Handling (Validierung, EXIF-Entfernung, Pfadsicherheit).

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import {
  normalizeUpload,
  readReferenceImage,
  scanImagePath,
  sniffImageType,
  REF_CACHE_DIR,
} from "../src/lib/images.js";

async function jpeg(width = 40, height = 60): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

async function png(): Promise<Buffer> {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

test("sniffImageType erkennt JPEG/PNG/WebP", async () => {
  assert.equal(sniffImageType(await jpeg()), "jpeg");
  assert.equal(sniffImageType(await png()), "png");
  const webp = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .webp()
    .toBuffer();
  assert.equal(sniffImageType(webp), "webp");
});

test("sniffImageType lehnt HTML-Fehlerseite ab", () => {
  const html = Buffer.from("<!DOCTYPE html><html><body>404 Not Found</body></html>");
  assert.equal(sniffImageType(html), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
  assert.equal(sniffImageType(Buffer.from("kurz")), null);
});

test("normalizeUpload lehnt leere Datei und Nicht-Bild ab", async () => {
  await assert.rejects(() => normalizeUpload(Buffer.alloc(0)), /Leere Datei/);
  await assert.rejects(
    () => normalizeUpload(Buffer.from("<html>nope</html>")),
    /Kein gueltiges Bild/,
  );
});

test("normalizeUpload entfernt Metadaten (EXIF/GPS)", async () => {
  const withExif = await sharp({
    create: { width: 50, height: 70, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .withMetadata({ exif: { IFD0: { Copyright: "Test", Software: "geheim" } } })
    .jpeg()
    .toBuffer();

  // Vorher: EXIF vorhanden
  const before = await sharp(withExif).metadata();
  assert.ok(before.exif && before.exif.length > 0, "Testfoto sollte EXIF haben");

  const out = await normalizeUpload(withExif);
  const after = await sharp(out.buffer).metadata();
  assert.equal(after.exif, undefined, "EXIF muss entfernt sein");
  assert.equal(out.width, 50);
  assert.equal(out.height, 70);
});

test("normalizeUpload skaliert grosse Bilder herunter", async () => {
  const big = await sharp({
    create: { width: 3000, height: 4000, channels: 3, background: { r: 1, g: 1, b: 1 } },
  })
    .jpeg()
    .toBuffer();
  const out = await normalizeUpload(big);
  assert.ok(Math.max(out.width, out.height) <= 2200, `zu gross: ${out.width}x${out.height}`);
  assert.equal(Math.round((out.width / out.height) * 100), 75); // Seitenverhaeltnis bleibt
});

test("scanImagePath verhindert Pfad-Traversal", () => {
  assert.ok(scanImagePath("scans/abc.jpg"));
  assert.equal(scanImagePath("../../etc/passwd"), null);
  assert.equal(scanImagePath("scans/../../../etc/passwd"), null);
});

test("readReferenceImage liefert null fuer HTML statt Bild", async () => {
  const dir = path.join(REF_CACHE_DIR, "cards");
  await fs.mkdir(dir, { recursive: true });
  const fakeId = `test-html-${Date.now()}`;
  const file = path.join(dir, `${fakeId}.jpg`);
  await fs.writeFile(file, "<html>error page</html>");
  try {
    assert.equal(await readReferenceImage(fakeId), null);
    assert.equal(await readReferenceImage("gar-nicht-vorhanden-xyz"), null);
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("normalizeUpload funktioniert aus temporaerem Verzeichnis", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pcs-"));
  const file = path.join(tmp, "in.jpg");
  await fs.writeFile(file, await jpeg(30, 30));
  const buf = await fs.readFile(file);
  const out = await normalizeUpload(buf);
  assert.equal(out.width, 30);
  await fs.rm(tmp, { recursive: true, force: true });
});
