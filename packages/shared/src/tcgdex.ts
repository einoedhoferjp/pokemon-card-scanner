export type TCGdexSet = {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  logo?: string;
  symbol?: string;
};

export type TCGdexCard = {
  id: string;
  name: string;
  number: string;
  hp?: string;
  rarity?: string;
  illustrator?: string;
  regulationMark?: string;
  types?: string[];
  image?: string;
  localImagePath?: string;
  set: {
    id: string;
    name?: string;
    logo?: string;
    symbol?: string;
  };
};

export type SyncStats = {
  setsFetched: number;
  cardsFetched: number;
  setsUpserted: number;
  cardsUpserted: number;
  imagesDownloaded: number;
  imagesSkipped: number;
  errors: string[];
  startedAt: string;
  finishedAt?: string;
};
