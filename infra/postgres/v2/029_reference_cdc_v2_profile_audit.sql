-- Append-only audit for the independently governed CDC reference profile.
-- 028 is already journaled on the target; never change its checksum.
CREATE TABLE reference_cdc_v2_profile_binding_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_instance_id text NOT NULL,
  profile_id text NOT NULL,
  profile_version text NOT NULL,
  coverage_epoch_id text NOT NULL,
  activation_at timestamptz NOT NULL,
  old_state text,
  new_state text NOT NULL,
  decision_ref text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (new_state IN ('SHADOW','ACTIVE','ROLLED_BACK'))
);

CREATE OR REPLACE FUNCTION audit_reference_cdc_v2_profile_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    previous_state := NULL;
  ELSE
    previous_state := OLD.state;
  END IF;
  IF TG_OP = 'INSERT' OR previous_state IS DISTINCT FROM NEW.state THEN
    INSERT INTO reference_cdc_v2_profile_binding_audit
      (source_instance_id,profile_id,profile_version,coverage_epoch_id,
       activation_at,old_state,new_state,decision_ref)
    VALUES
      (NEW.source_instance_id,NEW.profile_id,NEW.profile_version,
       NEW.coverage_epoch_id,NEW.activation_at,
       previous_state,NEW.state,NEW.decision_ref);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reference_cdc_v2_profile_binding_audit_trigger
AFTER INSERT OR UPDATE OF state ON reference_cdc_v2_profile_bindings
FOR EACH ROW EXECUTE FUNCTION audit_reference_cdc_v2_profile_binding();

CREATE OR REPLACE FUNCTION reject_reference_cdc_v2_profile_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reference CDC profile audit is append-only';
END;
$$;
CREATE TRIGGER reference_cdc_v2_profile_audit_immutable
BEFORE UPDATE OR DELETE ON reference_cdc_v2_profile_binding_audit
FOR EACH ROW EXECUTE FUNCTION reject_reference_cdc_v2_profile_audit_mutation();
