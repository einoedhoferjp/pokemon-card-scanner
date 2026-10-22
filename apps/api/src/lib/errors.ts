// Kleine Helfer fuer Fehlerobjekte.
//
// Fehler aus Bibliotheken sind `unknown`, nicht `any`: die Typen von `catch`
// sind per Sprachstandard `unknown` (mit `useUnknownInCatchVariables`), und
// `any` wuerde jeden Zugriff erlauben. Diese Helfer liefern die kurze,
// menschenlesbare Meldung, ohne den Typ aufzuweichen.

/** Meldung eines unbekannten Fehlers (fuer Logs und eigene Fehlertexte). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

/** HTTP-Status eines Axios-Fehlers, falls vorhanden. */
export function httpStatusOf(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const response = (e as { response?: { status?: unknown } }).response;
  const status = response?.status;
  return typeof status === "number" ? status : null;
}
