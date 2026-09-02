BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS funnel_maturity_finalizations_identity_idx
  ON funnel_maturity_finalizations (finalization_id, funnel_instance_id);

CREATE TABLE IF NOT EXISTS funnel_late_conversions (
  late_conversion_id TEXT PRIMARY KEY,
  finalization_id TEXT NOT NULL,
  funnel_instance_id TEXT NOT NULL UNIQUE REFERENCES funnel_instances(funnel_instance_id),
  source_id TEXT NOT NULL,
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  conversion_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  arrival_class TEXT NOT NULL
    CHECK (arrival_class IN ('TOO_LATE_FOR_FINAL_COHORT', 'AFTER_HORIZON')),
  conversion_occurred_at TIMESTAMPTZ NOT NULL,
  conversion_ingested_at TIMESTAMPTZ NOT NULL,
  link_method TEXT NOT NULL,
  link_confidence TEXT NOT NULL CHECK (link_confidence = 'STRONG'),
  matched_entity_type TEXT NOT NULL,
  official_outcome_status TEXT NOT NULL CHECK (official_outcome_status = 'DROPPED'),
  official_kpi_projection_revision BIGINT NOT NULL CHECK (official_kpi_projection_revision > 0),
  official_kpi_projection_hash CHAR(64) NOT NULL
    CHECK (official_kpi_projection_hash ~ '^[a-f0-9]{64}$'),
  detected_at TIMESTAMPTZ NOT NULL,
  late_conversion_document JSONB NOT NULL
    CHECK (jsonb_typeof(late_conversion_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (finalization_id, funnel_instance_id)
    REFERENCES funnel_maturity_finalizations(finalization_id, funnel_instance_id)
);

CREATE OR REPLACE FUNCTION reject_funnel_late_conversion_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'funnel late conversions are append-only';
END;
$$;

DROP TRIGGER IF EXISTS funnel_late_conversions_immutable
  ON funnel_late_conversions;
CREATE TRIGGER funnel_late_conversions_immutable
BEFORE UPDATE OR DELETE ON funnel_late_conversions
FOR EACH ROW EXECUTE FUNCTION reject_funnel_late_conversion_mutation();

CREATE INDEX IF NOT EXISTS funnel_late_conversions_scope_idx
  ON funnel_late_conversions (source_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS funnel_late_conversions_journey_idx
  ON funnel_late_conversions (journey_id, conversion_occurred_at);

COMMIT;
