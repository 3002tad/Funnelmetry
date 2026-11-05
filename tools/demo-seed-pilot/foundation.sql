-- Demo-only schema. Apply solely to an isolated demo database.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS funnelmetry_demo_seed;

CREATE TABLE IF NOT EXISTS funnelmetry_demo_seed.dataset_manifest (
  dataset_id text PRIMARY KEY,
  seed_version text NOT NULL,
  seed bigint NOT NULL,
  environment text NOT NULL CHECK (environment = 'OFFLINE_DEMO'),
  cutover_at timestamptz NOT NULL,
  cutover_status text NOT NULL CHECK (cutover_status = 'PROVISIONAL_OFFLINE_ONLY'),
  fixture_logical_sha256 text NOT NULL CHECK (fixture_logical_sha256 ~ '^[0-9a-f]{64}$'),
  foundation_logical_sha256 text NOT NULL CHECK (foundation_logical_sha256 ~ '^[0-9a-f]{64}$'),
  manifest jsonb NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS funnelmetry_demo_seed.entity_crosswalk (
  dataset_id text NOT NULL REFERENCES funnelmetry_demo_seed.dataset_manifest(dataset_id),
  entity_type text NOT NULL CHECK (entity_type IN ('product','variant','category')),
  demo_entity_key text NOT NULL,
  source_id text NOT NULL,
  source_entity_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  origin text NOT NULL CHECK (origin IN ('SYNTHETIC_BACKFILL','OBSERVED_SOURCE')),
  mapping_status text NOT NULL CHECK (mapping_status IN ('FIXTURE_ONLY','UNVERIFIED')),
  mapping_evidence text NOT NULL CHECK (length(btrim(mapping_evidence)) > 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (dataset_id, entity_type, demo_entity_key, source_id, source_entity_id, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK ((origin = 'SYNTHETIC_BACKFILL' AND mapping_status = 'FIXTURE_ONLY') OR
         (origin = 'OBSERVED_SOURCE' AND mapping_status = 'UNVERIFIED')),
  EXCLUDE USING gist (dataset_id WITH =, entity_type WITH =, source_id WITH =,
    source_entity_id WITH =, tstzrange(valid_from, valid_to, '[)') WITH &&),
  EXCLUDE USING gist (dataset_id WITH =, entity_type WITH =, source_id WITH =,
    demo_entity_key WITH =, tstzrange(valid_from, valid_to, '[)') WITH &&)
);

CREATE TABLE IF NOT EXISTS funnelmetry_demo_seed.coverage_interval (
  dataset_id text NOT NULL REFERENCES funnelmetry_demo_seed.dataset_manifest(dataset_id),
  domain text NOT NULL CHECK (domain IN ('browser','cart','catalog','order')),
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  interval_start timestamptz NOT NULL,
  interval_end timestamptz,
  status text NOT NULL CHECK (status IN ('COMPLETE','INCOMPLETE','UNVERIFIED')),
  origin text NOT NULL CHECK (origin IN ('SYNTHETIC_BACKFILL','OBSERVED_SOURCE')),
  evidence text NOT NULL CHECK (length(btrim(evidence)) > 0),
  source_checkpoint text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (dataset_id, domain, source_id, coverage_epoch_id, interval_start),
  CHECK (interval_end IS NULL OR interval_end > interval_start),
  CHECK (origin <> 'OBSERVED_SOURCE' OR status <> 'COMPLETE' OR source_checkpoint IS NOT NULL),
  CHECK (origin <> 'SYNTHETIC_BACKFILL' OR evidence = 'SYNTHETIC_FIXTURE_ONLY'),
  EXCLUDE USING gist (dataset_id WITH =, domain WITH =, source_id WITH =,
    coverage_epoch_id WITH =, tstzrange(interval_start, interval_end, '[)') WITH &&)
);
