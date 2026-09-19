BEGIN;

-- Kafka handoff progress only: NOT a downstream processing-safe checkpoint.
CREATE TABLE IF NOT EXISTS source_connector_cursors (
  connector_id TEXT PRIMARY KEY CHECK (length(connector_id) > 0),
  event_feed_id TEXT NOT NULL CHECK (length(event_feed_id) > 0),
  after_seq BIGINT NOT NULL CHECK (after_seq BETWEEN 0 AND 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
