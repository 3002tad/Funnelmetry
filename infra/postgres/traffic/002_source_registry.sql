-- Current, source-scoped mapping of exact raw utm_source values to operator-owned
-- labels. Only a digest is persisted; this is not anonymous data and must stay
-- inside the Pipeline DB privilege boundary. No historical event is rewritten.
BEGIN;

CREATE TABLE IF NOT EXISTS traffic_source_registry_v1 (
  source_id TEXT NOT NULL CHECK (source_id ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  raw_utm_source_hash CHAR(64) NOT NULL CHECK (raw_utm_source_hash ~ '^[a-f0-9]{64}$'),
  canonical_label TEXT NOT NULL CHECK (canonical_label ~ '^[a-z][a-z0-9._-]{0,63}$'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, raw_utm_source_hash)
);
CREATE INDEX IF NOT EXISTS traffic_source_registry_label_idx
  ON traffic_source_registry_v1 (source_id, canonical_label);

CREATE TABLE IF NOT EXISTS traffic_source_registry_audit_v1 (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL,
  raw_utm_source_hash CHAR(64) NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  canonical_label TEXT NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ASSIGNED', 'REASSIGNED')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, raw_utm_source_hash, version)
);
CREATE INDEX IF NOT EXISTS traffic_source_registry_audit_time_idx
  ON traffic_source_registry_audit_v1 (source_id, recorded_at DESC);

-- Fail closed on an incompatible table already present under the same name.
DO $$
BEGIN
  IF EXISTS (
    WITH expected(name, kind, nullable, max_length) AS (VALUES
      ('source_id', 'text', 'NO', NULL::integer),
      ('raw_utm_source_hash', 'character', 'NO', 64),
      ('canonical_label', 'text', 'NO', NULL::integer),
      ('version', 'integer', 'NO', NULL::integer),
      ('created_by', 'uuid', 'NO', NULL::integer),
      ('updated_by', 'uuid', 'NO', NULL::integer),
      ('created_at', 'timestamp with time zone', 'NO', NULL::integer),
      ('updated_at', 'timestamp with time zone', 'NO', NULL::integer)
    ), actual AS (
      SELECT * FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'traffic_source_registry_v1'
    )
    SELECT 1 FROM expected e FULL JOIN actual c ON c.column_name = e.name
    WHERE e.name IS NULL OR c.column_name IS NULL
      OR c.data_type IS DISTINCT FROM e.kind
      OR c.is_nullable IS DISTINCT FROM e.nullable
      OR c.character_maximum_length IS DISTINCT FROM e.max_length
  ) OR EXISTS (
    WITH expected(name, kind, nullable, max_length) AS (VALUES
      ('audit_id', 'uuid', 'NO', NULL::integer),
      ('source_id', 'text', 'NO', NULL::integer),
      ('raw_utm_source_hash', 'character', 'NO', 64),
      ('version', 'integer', 'NO', NULL::integer),
      ('canonical_label', 'text', 'NO', NULL::integer),
      ('actor_id', 'uuid', 'NO', NULL::integer),
      ('action', 'text', 'NO', NULL::integer),
      ('recorded_at', 'timestamp with time zone', 'NO', NULL::integer)
    ), actual AS (
      SELECT * FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'traffic_source_registry_audit_v1'
    )
    SELECT 1 FROM expected e FULL JOIN actual c ON c.column_name = e.name
    WHERE e.name IS NULL OR c.column_name IS NULL
      OR c.data_type IS DISTINCT FROM e.kind
      OR c.is_nullable IS DISTINCT FROM e.nullable
      OR c.character_maximum_length IS DISTINCT FROM e.max_length
  ) THEN
    RAISE EXCEPTION 'traffic source registry schema mismatch';
  END IF;
END $$;

COMMIT;
