BEGIN;

CREATE TABLE IF NOT EXISTS journeys (
  journey_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  first_event_at TIMESTAMPTZ NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (last_event_at >= first_event_at)
);

CREATE TABLE IF NOT EXISTS journey_entities (
  source_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  linked_at TIMESTAMPTZ NOT NULL,
  link_method TEXT NOT NULL,
  link_confidence TEXT NOT NULL CHECK (link_confidence IN ('STRONG', 'MEDIUM', 'WEAK')),
  evidence_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  PRIMARY KEY (source_id, entity_type, entity_key)
);

CREATE TABLE IF NOT EXISTS journey_events (
  canonical_event_id TEXT PRIMARY KEY REFERENCES canonical_events(canonical_event_id),
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  link_method TEXT NOT NULL,
  link_confidence TEXT NOT NULL CHECK (link_confidence IN ('STRONG', 'MEDIUM', 'WEAK', 'ISOLATED')),
  matched_entity_type TEXT,
  matched_entity_key TEXT,
  linked_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (matched_entity_type IS NULL AND matched_entity_key IS NULL)
    OR (matched_entity_type IS NOT NULL AND matched_entity_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS journeys_source_last_event_idx
  ON journeys (source_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS journey_events_journey_time_idx
  ON journey_events (journey_id, occurred_at, canonical_event_id);

CREATE INDEX IF NOT EXISTS journey_entities_journey_idx
  ON journey_entities (journey_id);

COMMIT;
