// API-Client der Web-App.
//
// Basis-URL: VITE_API_URL, sonst automatisch derselbe Host auf Port 3000
// (wichtig fuer Handy-Tests im LAN: http://<rechner-ip>:5173 -> API :3000).
// Fuer das Deployment hinter einem Reverse-Proxy (eine Herkunft fuer Web + API)
// wird `VITE_API_URL=same-origin` gesetzt, dann laufen alle Anfragen relativ.
//
// Alle Anfragen schicken Cookies mit (`credentials: "include"`) - noetig fuer
// Sitzung und Anonym-Cookie.

import type {
  AuthUser,
  CardCondition,
  CardSummary,
  CollectionItem,
  CollectionItemInput,
  CollectionItemPatch,
  CollectionStats,
  Scan,
  ScanFeedback,
} from "@shared/types";

function defaultApiBase(): string {
  if (typeof window === "undefined") return "http://localhost:3000";
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3000";
  return `${protocol}//${hostname}:3000`;
}

/**
 * Basis-URL aus `VITE_API_URL`:
 * - nicht gesetzt  → Standard (siehe `defaultApiBase`)
 * - `same-origin`  → leere Basis, Anfragen laufen relativ zur eigenen Herkunft
 *   (Produktion: Caddy leitet /cards, /scans, /collection, /auth, /health an die API)
 */
function configuredApiBase(): string | null {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!raw) return null;
  if (raw === "/" || raw === "same-origin") return "";
  return raw.replace(/\/$/, "");
}

export const API_BASE = configuredApiBase() ?? defaultApiBase();

/** Macht relative API-Pfade (/cards/.../image) absolut. */
export function apiUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* kein JSON */
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function get(path: string): Promise<Response> {
  return request(path);
}

function send(path: string, method: string, body: unknown): Promise<Response> {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Zentrale Anfrage: schickt Cookies mit und uebersetzt Netzwerkfehler in eine
 * verstaendliche Meldung (offline, Server aus) statt "Failed to fetch".
 */
function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { credentials: "include", ...init }).catch(() => {
    throw new ApiError("Keine Verbindung zum Server – bitte Internet prüfen.", 0);
  });
}

// --- Scans -----------------------------------------------------------------

export async function createScan(image: Blob, filename = "scan.jpg"): Promise<Scan> {
  const form = new FormData();
  form.append("image", image, filename);
  const res = await request(`/scans`, { method: "POST", body: form });
  return handle<Scan>(res);
}

export async function getScan(id: string): Promise<{ scan: Scan; cards: CardSummary[] }> {
  return handle(await get(`/scans/${id}`));
}

export type ScanListItem = Scan;

export async function listScans(limit = 30): Promise<ScanListItem[]> {
  const res = await handle<{ scans: ScanListItem[] }>(await get(`/scans?limit=${limit}`));
  return res.scans;
}

export async function sendFeedback(id: string, feedback: ScanFeedback): Promise<Scan> {
  return handle<Scan>(await send(`/scans/${id}`, "PATCH", feedback));
}

export async function deleteScan(id: string): Promise<void> {
  await handle(await request(`/scans/${id}`, { method: "DELETE" }));
}

// --- Karten ----------------------------------------------------------------

export async function searchCards(q: string, limit = 20): Promise<CardSummary[]> {
  const res = await handle<{ results: CardSummary[] }>(
    await get(`/cards/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  );
  return res.results;
}

export async function getCard(tcgdexId: string): Promise<CardSummary> {
  return handle(await get(`/cards/${encodeURIComponent(tcgdexId)}`));
}

export function cardImageUrl(tcgdexId: string): string {
  return `${API_BASE}/cards/${encodeURIComponent(tcgdexId)}/image`;
}

// --- Anmeldung -------------------------------------------------------------

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await handle<{ user: AuthUser | null }>(await get("/auth/me"));
  return res.user;
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ user: AuthUser; claimedScans: number }> {
  return handle(await send("/auth/register", "POST", { email, password, displayName }));
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AuthUser; claimedScans: number }> {
  return handle(await send("/auth/login", "POST", { email, password }));
}

export async function logout(): Promise<void> {
  await handle(await send("/auth/logout", "POST", {}));
}

export async function updateProfile(patch: {
  displayName?: string | null;
  password?: string;
  currentPassword?: string;
}): Promise<AuthUser> {
  const res = await handle<{ user: AuthUser }>(await send("/auth/me", "PATCH", patch));
  return res.user;
}

// --- Sammlung --------------------------------------------------------------

export async function listCollection(
  params: {
    q?: string;
    set?: string;
    condition?: CardCondition;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: CollectionItem[]; total: number; totalCards: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.set) query.set("set", params.set);
  if (params.condition) query.set("condition", params.condition);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return handle(await get(`/collection?${query.toString()}`));
}

export async function collectionStats(): Promise<CollectionStats> {
  return handle(await get("/collection/stats"));
}

export async function addToCollection(input: CollectionItemInput): Promise<CollectionItem> {
  return handle(await send("/collection", "POST", input));
}

export async function updateCollectionItem(
  id: string,
  patch: CollectionItemPatch,
): Promise<CollectionItem> {
  return handle(await send(`/collection/${id}`, "PATCH", patch));
}

export async function removeCollectionItem(id: string): Promise<void> {
  await handle(await request(`/collection/${id}`, { method: "DELETE" }));
}

export async function ownedQuantity(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const res = await handle<{ owned: Array<{ cardId: string; quantity: number }> }>(
    await get(`/collection/has?ids=${encodeURIComponent(ids.join(","))}`),
  );
  return Object.fromEntries(res.owned.map((o) => [o.cardId, o.quantity]));
}
