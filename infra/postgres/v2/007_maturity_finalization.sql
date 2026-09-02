BEGIN;

ALTER TABLE funnel_kpi_instance_facts
  ADD COLUMN IF NOT EXISTS latest_projection_kind TEXT NOT NULL DEFAULT 'CANONICAL_EVENT'
    CHECK (latest_projection_kind IN ('CANONICAL_EVENT', 'MATURITY_FINALIZATION'));

ALTER TABLE funnel_kpi_instance_facts
  ADD COLUMN IF NOT EXISTS latest_projection_id TEXT;

UPDATE funnel_kpi_instance_facts
   SET latest_projection_id = latest_trigger_event_id
 WHERE latest_projection_id IS NULL;

CREATE OR REPLACE FUNCTION default_kpi_projection_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latest_projection_id IS NULL THEN
    NEW.latest_projection_kind := 'CANONICAL_EVENT';
    NEW.latest_projection_id := NEW.latest_trigger_event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS funnel_kpi_projection_identity_default
  ON funnel_kpi_instance_facts;
CREATE TRIGGER funnel_kpi_projection_identity_default
BEFORE INSERT OR UPDATE ON funnel_kpi_instance_facts
FOR EACH ROW EXECUTE FUNCTION default_kpi_projection_identity();

ALTER TABLE funnel_kpi_instance_facts
  ALTER COLUMN latest_projection_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS funnel_maturity_finalizations (
  finalization_id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL UNIQUE REFERENCES funnel_maturity_evaluations(evaluation_id),
  funnel_instance_id TEXT NOT NULL UNIQUE REFERENCES funnel_instances(funnel_instance_id),
  source_id TEXT NOT NULL,
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  previous_outcome_status TEXT NOT NULL CHECK (previous_outcome_status = 'IN_PROGRESS'),
  finalized_outcome_status TEXT NOT NULL CHECK (finalized_outcome_status = 'DROPPED'),
  kpi_projection_revision BIGINT NOT NULL CHECK (kpi_projection_revision > 0),
  kpi_projection_hash CHAR(64) NOT NULL CHECK (kpi_projection_hash ~ '^[a-f0-9]{64}$'),
  finalized_at TIMESTAMPTZ NOT NULL,
  finalization_document JSONB NOT NULL CHECK (jsonb_typeof(finalization_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION reject_funnel_maturity_finalization_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'funnel maturity finalizations are append-only';
END;
$$;

DROP TRIGGER IF EXISTS funnel_maturity_finalizations_immutable
  ON funnel_maturity_finalizations;
CREATE TRIGGER funnel_maturity_finalizations_immutable
BEFORE UPDATE OR DELETE ON funnel_maturity_finalizations
FOR EACH ROW EXECUTE FUNCTION reject_funnel_maturity_finalization_mutation();

CREATE INDEX IF NOT EXISTS funnel_maturity_finalizations_scope_idx
  ON funnel_maturity_finalizations (source_id, finalized_at DESC);

COMMIT;
