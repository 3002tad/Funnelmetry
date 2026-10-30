-- Separate, versioned reference current-state profile. The canonical
-- funnel_profiles/funnel_instances path cannot represent retractable CDC OFF.
-- This migration creates no release or active binding.
CREATE TABLE reference_cdc_v2_profile_releases (
  profile_id text NOT NULL,
  profile_version text NOT NULL,
  contract_id text NOT NULL,
  metric_id text NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (profile_id, profile_version),
  CHECK (profile_id = 'reference-commerce-current-state'),
  CHECK (contract_id = 'reference.medusa.order_recorded_state.v2')
);

CREATE TABLE reference_cdc_v2_profile_bindings (
  source_instance_id text NOT NULL,
  profile_id text NOT NULL,
  profile_version text NOT NULL,
  coverage_epoch_id text NOT NULL,
  activation_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('SHADOW','ACTIVE','ROLLED_BACK')),
  decision_ref text NOT NULL,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_instance_id, profile_id, profile_version),
  FOREIGN KEY (profile_id, profile_version)
    REFERENCES reference_cdc_v2_profile_releases(profile_id, profile_version),
  CHECK (state <> 'ACTIVE' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX reference_cdc_v2_one_active_profile_per_source
  ON reference_cdc_v2_profile_bindings(source_instance_id)
  WHERE state = 'ACTIVE';

CREATE OR REPLACE FUNCTION reject_reference_cdc_v2_profile_release_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reference CDC profile releases are immutable; publish a new version';
END;
$$;
CREATE TRIGGER reference_cdc_v2_profile_releases_immutable
BEFORE UPDATE OR DELETE ON reference_cdc_v2_profile_releases
FOR EACH ROW EXECUTE FUNCTION reject_reference_cdc_v2_profile_release_mutation();
