BEGIN;

CREATE TABLE IF NOT EXISTS funnel_kpi_instance_facts (
  funnel_instance_id TEXT PRIMARY KEY REFERENCES funnel_instances(funnel_instance_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  funnel_profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  entry_at TIMESTAMPTZ NOT NULL,
  conversion_deadline TIMESTAMPTZ,
  outcome_status TEXT NOT NULL
    CHECK (outcome_status IN ('IN_PROGRESS', 'CONVERTED', 'DROPPED', 'TERMINATED', 'INVALID')),
  quality_status TEXT NOT NULL
    CHECK (quality_status IN ('PROVISIONAL', 'RECONCILING', 'RECONCILED', 'DEGRADED')),
  converted_at TIMESTAMPTZ,
  reached_step_count INTEGER NOT NULL CHECK (reached_step_count >= 0),
  total_step_count INTEGER NOT NULL CHECK (total_step_count > 0),
  branch_count INTEGER NOT NULL CHECK (branch_count >= 0),
  latest_trigger_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  projection_hash CHAR(64) NOT NULL CHECK (projection_hash ~ '^[a-f0-9]{64}$'),
  projection_revision BIGINT NOT NULL DEFAULT 1 CHECK (projection_revision > 0),
  projected_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (funnel_profile_id, profile_version)
    REFERENCES funnel_profiles(funnel_profile_id, profile_version),
  CHECK (reached_step_count <= total_step_count),
  CHECK ((outcome_status = 'CONVERTED') = (converted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS funnel_kpi_step_facts (
  funnel_instance_id TEXT NOT NULL REFERENCES funnel_kpi_instance_facts(funnel_instance_id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  step_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  first_reached_at TIMESTAMPTZ NOT NULL,
  last_reached_at TIMESTAMPTZ NOT NULL,
  occurrence_count BIGINT NOT NULL CHECK (occurrence_count > 0),
  PRIMARY KEY (funnel_instance_id, step_index),
  CHECK (last_reached_at >= first_reached_at)
);

CREATE TABLE IF NOT EXISTS funnel_kpi_branch_facts (
  funnel_instance_id TEXT NOT NULL REFERENCES funnel_kpi_instance_facts(funnel_instance_id) ON DELETE CASCADE,
  canonical_event_id TEXT NOT NULL REFERENCES canonical_events(canonical_event_id),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  branch_kind TEXT NOT NULL,
  PRIMARY KEY (funnel_instance_id, canonical_event_id)
);

CREATE TABLE IF NOT EXISTS kpi_projection_applications (
  trigger_event_id TEXT PRIMARY KEY REFERENCES canonical_events(canonical_event_id),
  journey_id TEXT NOT NULL REFERENCES journeys(journey_id),
  source_id TEXT NOT NULL,
  changed_instance_count INTEGER NOT NULL CHECK (changed_instance_count >= 0),
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS funnel_kpi_instance_profile_entry_idx
  ON funnel_kpi_instance_facts (source_id, funnel_profile_id, profile_version, entry_at);

CREATE INDEX IF NOT EXISTS funnel_kpi_instance_quality_outcome_idx
  ON funnel_kpi_instance_facts (quality_status, outcome_status, entry_at);

CREATE OR REPLACE VIEW funnel_kpi_profile_observed_totals AS
SELECT
  source_id,
  funnel_profile_id,
  profile_version,
  COUNT(*)::BIGINT AS entrants,
  COUNT(*) FILTER (WHERE outcome_status = 'CONVERTED')::BIGINT AS observed_converted,
  COUNT(*) FILTER (WHERE outcome_status = 'IN_PROGRESS')::BIGINT AS pending,
  COUNT(*) FILTER (WHERE outcome_status = 'DROPPED')::BIGINT AS dropped,
  COUNT(*) FILTER (WHERE quality_status = 'PROVISIONAL')::BIGINT AS provisional,
  COUNT(*) FILTER (WHERE quality_status = 'RECONCILED')::BIGINT AS reconciled,
  COUNT(*) FILTER (WHERE quality_status = 'DEGRADED')::BIGINT AS degraded,
  COUNT(*) FILTER (WHERE branch_count > 0)::BIGINT AS instances_with_branches,
  COUNT(*) FILTER (WHERE outcome_status = 'CONVERTED')::NUMERIC
    / NULLIF(COUNT(*), 0) AS observed_end_to_end_rate,
  MIN(entry_at) AS first_entry_at,
  MAX(entry_at) AS last_entry_at
FROM funnel_kpi_instance_facts
GROUP BY source_id, funnel_profile_id, profile_version;

CREATE OR REPLACE VIEW funnel_kpi_step_observed_totals AS
WITH scopes AS (
  SELECT DISTINCT source_id, funnel_profile_id, profile_version
  FROM funnel_kpi_instance_facts
)
SELECT
  scopes.source_id,
  steps.funnel_profile_id,
  steps.profile_version,
  steps.step_index,
  steps.step_id,
  steps.event_type,
  COUNT(instances.funnel_instance_id)::BIGINT AS entrants,
  COUNT(reached.funnel_instance_id)::BIGINT AS reached,
  COUNT(reached.funnel_instance_id)::NUMERIC
    / NULLIF(COUNT(instances.funnel_instance_id), 0) AS observed_reach_rate
FROM scopes
JOIN funnel_profile_steps steps
  ON steps.funnel_profile_id = scopes.funnel_profile_id
 AND steps.profile_version = scopes.profile_version
LEFT JOIN funnel_kpi_instance_facts instances
  ON instances.source_id = scopes.source_id
 AND instances.funnel_profile_id = steps.funnel_profile_id
 AND instances.profile_version = steps.profile_version
LEFT JOIN funnel_kpi_step_facts reached
  ON reached.funnel_instance_id = instances.funnel_instance_id
 AND reached.step_index = steps.step_index
GROUP BY scopes.source_id, steps.funnel_profile_id, steps.profile_version,
         steps.step_index, steps.step_id, steps.event_type;

COMMIT;
