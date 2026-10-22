// Helfer fuer Fehlerobjekte in der Oberflaeche.
//
// Fehler aus `catch` sind `unknown` (nicht `any`). Diese Helfer liefern die
// kurze, menschenlesbare Meldung - die API schickt bei Fehlern bewusst nur
// einen knappen Text, mehr gibt es nicht anzuzeigen.

/** Meldung eines unbekannten Fehlers. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

/** Name eines unbekannten Fehlers (z. B. "NotAllowedError" bei der Kamera). */
export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "";
}
