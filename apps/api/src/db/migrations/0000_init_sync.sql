CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE sync_job_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tcgdex_id text NOT NULL UNIQUE,
  name_de text,
  name_en text,
  series text,
  release_date text,
  logo_url text,
  symbol_path text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sets_tcgdex_id_idx ON sets(tcgdex_id);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tcgdex_id text NOT NULL UNIQUE,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE RESTRICT,
  number text NOT NULL,
  name_de text,
  name_en text,
  hp text,
  rarity text,
  types jsonb DEFAULT '[]'::jsonb,
  illustrator text,
  regulation_mark text,
  variants_known jsonb DEFAULT '[]'::jsonb,
  language_hint text DEFAULT 'de',
  image_url text,
  local_image_path text,
  has_holo boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cards_tcgdex_id_idx ON cards(tcgdex_id);
CREATE INDEX cards_set_number_idx ON cards(set_id, number);

CREATE TABLE card_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  model text NOT NULL,
  dim integer NOT NULL,
  vector vector,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX card_embeddings_card_model_idx ON card_embeddings(card_id, model);

CREATE TABLE sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status sync_job_status NOT NULL DEFAULT 'pending',
  stats_json jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
