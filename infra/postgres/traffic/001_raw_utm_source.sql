-- Additive, forward-only acquisition projection. Hashes are not a canonical
-- traffic channel or an attribution metric. Existing rows are never
-- backfilled by this migration; only retained/replayed Raw Kafka can populate it.
BEGIN;

CREATE TABLE IF NOT EXISTS traffic_source_raw_events_v1 (
  source_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  raw_record_id TEXT NOT NULL,
  raw_content_hash CHAR(64) NOT NULL CHECK (raw_content_hash ~ '^[a-f0-9]{64}$'),
  received_at TIMESTAMPTZ NOT NULL,
  utm_source_state TEXT NOT NULL CHECK (utm_source_state IN ('PRESENT', 'ABSENT', 'INVALID')),
  utm_source_hash CHAR(64) CHECK (utm_source_hash ~ '^[a-f0-9]{64}$'),
  synthetic BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, source_event_id),
  CONSTRAINT traffic_utm_source_shape CHECK (
    (utm_source_state = 'PRESENT' AND utm_source_hash IS NOT NULL)
    OR (utm_source_state <> 'PRESENT' AND utm_source_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS traffic_source_raw_events_received_at_idx
  ON traffic_source_raw_events_v1 (source_id, received_at);

-- IF NOT EXISTS must not silently accept an incompatible preexisting table.
DO $$
BEGIN
  IF EXISTS (
    WITH expected(name, kind, nullable, max_length) AS (VALUES
      ('source_id', 'text', 'NO', NULL::integer),
      ('source_event_id', 'text', 'NO', NULL::integer),
      ('source_event_type', 'text', 'NO', NULL::integer),
      ('source_schema_version', 'text', 'NO', NULL::integer),
      ('raw_record_id', 'text', 'NO', NULL::integer),
      ('raw_content_hash', 'character', 'NO', 64),
      ('received_at', 'timestamp with time zone', 'NO', NULL::integer),
      ('utm_source_state', 'text', 'NO', NULL::integer),
      ('utm_source_hash', 'character', 'YES', 64),
      ('synthetic', 'boolean', 'NO', NULL::integer),
      ('recorded_at', 'timestamp with time zone', 'NO', NULL::integer)
    ), actual AS (
      SELECT * FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'traffic_source_raw_events_v1'
    )
    SELECT 1 FROM expected e
    FULL JOIN actual c ON c.column_name = e.name
    WHERE e.name IS NULL OR c.column_name IS NULL
      OR c.data_type IS DISTINCT FROM e.kind
      OR c.is_nullable IS DISTINCT FROM e.nullable
      OR c.character_maximum_length IS DISTINCT FROM e.max_length
  ) OR (SELECT ARRAY_AGG(k.column_name ORDER BY k.ordinal_position)::text[]
          FROM information_schema.table_constraints t
          JOIN information_schema.key_column_usage k
            ON k.constraint_catalog = t.constraint_catalog
           AND k.constraint_schema = t.constraint_schema
           AND k.constraint_name = t.constraint_name
          WHERE t.table_schema = 'public' AND t.table_name = 'traffic_source_raw_events_v1'
            AND t.constraint_type = 'PRIMARY KEY')
          IS DISTINCT FROM ARRAY['source_id','source_event_id']::text[] THEN
    RAISE EXCEPTION 'traffic_source_raw_events_v1 schema mismatch';
  END IF;
END $$;

COMMIT;
