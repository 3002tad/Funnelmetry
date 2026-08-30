BEGIN;

CREATE TABLE IF NOT EXISTS funnel_profiles (
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  subject_scope TEXT NOT NULL,
  entry_event_type TEXT NOT NULL,
  profile_document JSONB NOT NULL,
  conversion_horizon_seconds BIGINT CHECK (conversion_horizon_seconds > 0),
  late_arrival_grace_seconds BIGINT CHECK (late_arrival_grace_seconds >= 0),
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (funnel_profile_id, profile_version),
  CHECK (jsonb_typeof(profile_document) = 'object')
);

CREATE TABLE IF NOT EXISTS funnel_profile_steps (
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  step_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_class TEXT NOT NULL CHECK (event_class IN ('BEHAVIOR_INTENT', 'CLIENT_OBSERVATION', 'BUSINESS_FACT')),
  PRIMARY KEY (funnel_profile_id, profile_version, step_index),
  UNIQUE (funnel_profile_id, profile_version, step_id),
  FOREIGN KEY (funnel_profile_id, profile_version)
    REFERENCES funnel_profiles(funnel_profile_id, profile_version)
);

CREATE TABLE IF NOT EXISTS funnel_profile_negative_events (
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  PRIMARY KEY (funnel_profile_id, profile_version, event_type),
  FOREIGN KEY (funnel_profile_id, profile_version)
    REFERENCES funnel_profiles(funnel_profile_id, profile_version)
);

CREATE TABLE IF NOT EXISTS funnel_profile_activations (
  source_id TEXT NOT NULL,
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ,
  PRIMARY KEY (source_id, funnel_profile_id, profile_version),
  FOREIGN KEY (funnel_profile_id, profile_version)
    REFERENCES funnel_profiles(funnel_profile_id, profile_version),
  CHECK (disabled_at IS NULL OR disabled_at >= enabled_at)
);

CREATE TABLE IF NOT EXISTS funnel_instances (
  funnel_instance_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  entry_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  entry_at TIMESTAMPTZ NOT NULL,
  conversion_deadline TIMESTAMPTZ,
  outcome_status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (outcome_status IN ('IN_PROGRESS', 'CONVERTED', 'DROPPED', 'TERMINATED', 'INVALID')),
  quality_status TEXT NOT NULL DEFAULT 'PROVISIONAL'
    CHECK (quality_status IN ('PROVISIONAL', 'RECONCILING', 'RECONCILED', 'DEGRADED')),
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (funnel_profile_id, profile_version, journey_id, entry_event_id),
  FOREIGN KEY (funnel_profile_id, profile_version)
    REFERENCES funnel_profiles(funnel_profile_id, profile_version),
  CHECK (conversion_deadline IS NULL OR conversion_deadline >= entry_at),
  CHECK ((outcome_status = 'CONVERTED') = (converted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS funnel_instance_steps (
  funnel_instance_id TEXT NOT NULL REFERENCES funnel_instances(funnel_instance_id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  step_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  representative_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  first_reached_at TIMESTAMPTZ NOT NULL,
  last_reached_at TIMESTAMPTZ NOT NULL,
  occurrence_count BIGINT NOT NULL CHECK (occurrence_count > 0),
  sequence_status TEXT NOT NULL CHECK (sequence_status IN ('IN_ORDER', 'OUT_OF_ORDER')),
  PRIMARY KEY (funnel_instance_id, step_index),
  CHECK (last_reached_at >= first_reached_at)
);

CREATE TABLE IF NOT EXISTS funnel_instance_branches (
  funnel_instance_id TEXT NOT NULL REFERENCES funnel_instances(funnel_instance_id) ON DELETE CASCADE,
  canonical_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  branch_kind TEXT NOT NULL CHECK (branch_kind IN ('NEGATIVE_EVENT')),
  PRIMARY KEY (funnel_instance_id, canonical_event_id)
);

CREATE TABLE IF NOT EXISTS funnel_event_applications (
  canonical_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  application_status TEXT NOT NULL CHECK (application_status IN ('APPLIED', 'NO_OPEN_INSTANCE')),
  applied_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (canonical_event_id, funnel_profile_id, profile_version),
  FOREIGN KEY (funnel_profile_id, profile_version)
    REFERENCES funnel_profiles(funnel_profile_id, profile_version)
);

CREATE INDEX IF NOT EXISTS funnel_profile_steps_event_idx
  ON funnel_profile_steps (event_type, event_class);

CREATE INDEX IF NOT EXISTS funnel_instances_journey_profile_idx
  ON funnel_instances (journey_id, funnel_profile_id, profile_version, entry_at);

CREATE INDEX IF NOT EXISTS funnel_instances_status_deadline_idx
  ON funnel_instances (outcome_status, conversion_deadline)
  WHERE outcome_status = 'IN_PROGRESS';

CREATE OR REPLACE FUNCTION reject_funnel_profile_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published funnel profiles are immutable; publish a new version instead';
END;
$$;

DROP TRIGGER IF EXISTS funnel_profiles_immutable ON funnel_profiles;
CREATE TRIGGER funnel_profiles_immutable
BEFORE UPDATE OR DELETE ON funnel_profiles
FOR EACH ROW EXECUTE FUNCTION reject_funnel_profile_mutation();

DROP TRIGGER IF EXISTS funnel_profile_steps_immutable ON funnel_profile_steps;
CREATE TRIGGER funnel_profile_steps_immutable
BEFORE UPDATE OR DELETE ON funnel_profile_steps
FOR EACH ROW EXECUTE FUNCTION reject_funnel_profile_mutation();

DROP TRIGGER IF EXISTS funnel_profile_negative_events_immutable ON funnel_profile_negative_events;
CREATE TRIGGER funnel_profile_negative_events_immutable
BEFORE UPDATE OR DELETE ON funnel_profile_negative_events
FOR EACH ROW EXECUTE FUNCTION reject_funnel_profile_mutation();

COMMIT;
