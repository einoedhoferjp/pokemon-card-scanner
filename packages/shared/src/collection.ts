// Anmeldung und Sammlung - von API und Web gemeinsam genutzte Typen.

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
};

export type AuthCredentials = {
  email: string;
  password: string;
  displayName?: string;
};

export type CardCondition = "mint" | "near_mint" | "excellent" | "good" | "played" | "poor";

export const CARD_CONDITIONS: CardCondition[] = [
  "mint",
  "near_mint",
  "excellent",
  "good",
  "played",
  "poor",
];

export type CollectionItem = {
  id: string;
  quantity: number;
  condition: CardCondition;
  language: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  card: {
    tcgdexId: string;
    nameDe: string | null;
    nameEn: string | null;
    number: string;
    setId: string;
    setName: string | null;
    rarity: string | null;
    imageUrl: string | null;
  };
};

export type CollectionItemInput = {
  /** tcgdex_id der Karte */
  cardId: string;
  quantity?: number;
  condition?: CardCondition;
  language?: string | null;
  notes?: string | null;
};

export type CollectionItemPatch = {
  quantity?: number;
  condition?: CardCondition;
  language?: string | null;
  notes?: string | null;
};

export type CollectionStats = {
  /** Summe aller Karten (inkl. Mehrfach). */
  totalCards: number;
  /** Anzahl unterschiedlicher Karten. */
  uniqueCards: number;
  byCondition: Array<{ condition: CardCondition; uniqueCards: number; totalCards: number }>;
  topSets: Array<{
    setId: string;
    setName: string | null;
    uniqueCards: number;
    totalCards: number;
  }>;
  lastAddedAt: string | null;
};
