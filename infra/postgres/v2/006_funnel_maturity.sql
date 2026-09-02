BEGIN;

CREATE TABLE IF NOT EXISTS funnel_profile_transition_timeouts (
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  next_step_id TEXT NOT NULL,
  timeout_seconds BIGINT NOT NULL CHECK (timeout_seconds > 0),
  PRIMARY KEY (funnel_profile_id, profile_version, next_step_id),
  FOREIGN KEY (funnel_profile_id, profile_version, next_step_id)
    REFERENCES funnel_profile_steps(funnel_profile_id, profile_version, step_id)
);

CREATE OR REPLACE FUNCTION validate_funnel_transition_timeout_target()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_index INTEGER;
BEGIN
  SELECT step_index INTO target_index
    FROM funnel_profile_steps
   WHERE funnel_profile_id = NEW.funnel_profile_id
     AND profile_version = NEW.profile_version
     AND step_id = NEW.next_step_id;
  IF target_index IS NULL OR target_index = 0 THEN
    RAISE EXCEPTION 'transition timeout must target a step after the entry step';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS funnel_profile_transition_timeout_target
  ON funnel_profile_transition_timeouts;
CREATE TRIGGER funnel_profile_transition_timeout_target
BEFORE INSERT OR UPDATE ON funnel_profile_transition_timeouts
FOR EACH ROW EXECUTE FUNCTION validate_funnel_transition_timeout_target();

DROP TRIGGER IF EXISTS funnel_profile_transition_timeouts_immutable
  ON funnel_profile_transition_timeouts;
CREATE TRIGGER funnel_profile_transition_timeouts_immutable
BEFORE UPDATE OR DELETE ON funnel_profile_transition_timeouts
FOR EACH ROW EXECUTE FUNCTION reject_funnel_profile_mutation();

CREATE TABLE IF NOT EXISTS funnel_maturity_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  funnel_instance_id TEXT NOT NULL REFERENCES funnel_instances(funnel_instance_id),
  source_id TEXT NOT NULL,
  evaluation_revision BIGINT NOT NULL CHECK (evaluation_revision > 0),
  maturity_state TEXT NOT NULL
    CHECK (maturity_state IN ('UNCONFIGURED', 'PENDING', 'SUSPECTED_DROPOFF', 'MATURED')),
  maturity_reason TEXT NOT NULL
    CHECK (maturity_reason IN (
      'TIME_POLICY_UNCONFIGURED', 'AWAITING_FINALIZATION',
      'TRANSITION_TIMEOUT_ELAPSED', 'HORIZON_GRACE_ELAPSED'
    )),
  eligibility_status TEXT NOT NULL
    CHECK (eligibility_status IN ('ELIGIBLE', 'INELIGIBLE', 'UNDETERMINED')),
  eligibility_reason TEXT
    CHECK (eligibility_reason IS NULL OR eligibility_reason IN (
      'TIME_POLICY_UNCONFIGURED', 'OUTCOME_NOT_ELIGIBLE', 'NON_AUTHORITATIVE_ENTRY_TIME'
    )),
  outcome_status_snapshot TEXT NOT NULL
    CHECK (outcome_status_snapshot IN ('IN_PROGRESS', 'CONVERTED', 'DROPPED', 'TERMINATED', 'INVALID')),
  quality_status_snapshot TEXT NOT NULL
    CHECK (quality_status_snapshot IN ('PROVISIONAL', 'RECONCILING', 'RECONCILED', 'DEGRADED')),
  authoritative_entry_time BOOLEAN NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  conversion_deadline TIMESTAMPTZ,
  finalization_at TIMESTAMPTZ,
  next_step_id TEXT,
  suspected_dropoff_at TIMESTAMPTZ,
  evidence_hash CHAR(64) NOT NULL,
  evaluation_document JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (funnel_instance_id, evaluation_revision),
  UNIQUE (funnel_instance_id, evidence_hash),
  CHECK (jsonb_typeof(evaluation_document) = 'object'),
  CHECK (
    (eligibility_status = 'ELIGIBLE' AND eligibility_reason IS NULL)
    OR (eligibility_status <> 'ELIGIBLE' AND eligibility_reason IS NOT NULL)
  ),
  CHECK (
    (maturity_state = 'UNCONFIGURED'
      AND maturity_reason = 'TIME_POLICY_UNCONFIGURED'
      AND conversion_deadline IS NULL AND finalization_at IS NULL
      AND suspected_dropoff_at IS NULL)
    OR (maturity_state = 'PENDING'
      AND maturity_reason = 'AWAITING_FINALIZATION'
      AND conversion_deadline IS NOT NULL AND finalization_at IS NOT NULL
      AND suspected_dropoff_at IS NULL)
    OR (maturity_state = 'SUSPECTED_DROPOFF'
      AND maturity_reason = 'TRANSITION_TIMEOUT_ELAPSED'
      AND conversion_deadline IS NOT NULL AND finalization_at IS NOT NULL
      AND next_step_id IS NOT NULL AND suspected_dropoff_at IS NOT NULL)
    OR (maturity_state = 'MATURED'
      AND maturity_reason = 'HORIZON_GRACE_ELAPSED'
      AND conversion_deadline IS NOT NULL AND finalization_at IS NOT NULL
      AND suspected_dropoff_at IS NULL)
  )
);

CREATE OR REPLACE FUNCTION reject_funnel_maturity_evaluation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'funnel maturity evaluations are append-only';
END;
$$;

DROP TRIGGER IF EXISTS funnel_maturity_evaluations_immutable
  ON funnel_maturity_evaluations;
CREATE TRIGGER funnel_maturity_evaluations_immutable
BEFORE UPDATE OR DELETE ON funnel_maturity_evaluations
FOR EACH ROW EXECUTE FUNCTION reject_funnel_maturity_evaluation_mutation();

CREATE INDEX IF NOT EXISTS funnel_maturity_evaluations_instance_idx
  ON funnel_maturity_evaluations (funnel_instance_id, evaluation_revision DESC);

CREATE INDEX IF NOT EXISTS funnel_maturity_evaluations_state_idx
  ON funnel_maturity_evaluations (source_id, maturity_state, evaluated_at DESC);

CREATE OR REPLACE VIEW funnel_instance_latest_maturity AS
SELECT DISTINCT ON (funnel_instance_id)
       evaluation_id, funnel_instance_id, source_id, evaluation_revision,
       maturity_state, maturity_reason, eligibility_status, eligibility_reason,
       outcome_status_snapshot, quality_status_snapshot, authoritative_entry_time,
       evaluated_at, conversion_deadline, finalization_at, next_step_id,
       suspected_dropoff_at, evidence_hash, recorded_at
  FROM funnel_maturity_evaluations
 ORDER BY funnel_instance_id, evaluation_revision DESC;

COMMIT;
