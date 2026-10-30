-- Run after candidate migration 028. No test release remains in the database.
BEGIN;
INSERT INTO reference_cdc_v2_profile_releases
  (profile_id,profile_version,contract_id,metric_id,definition)
VALUES
  ('reference-commerce-current-state','test-v2',
   'reference.medusa.order_recorded_state.v2','metric.test_current_state',
   '{"grain":"journey","retractable":true}'::jsonb),
  ('reference-commerce-current-state','test-v3',
   'reference.medusa.order_recorded_state.v2','metric.test_current_state',
   '{"grain":"journey","retractable":true}'::jsonb);

INSERT INTO reference_cdc_v2_profile_bindings
  (source_instance_id,profile_id,profile_version,coverage_epoch_id,
   activation_at,state,decision_ref)
VALUES
  ('test-source','reference-commerce-current-state','test-v2',
   'test-epoch','2026-10-30T04:29:31.042Z','SHADOW','test-only');
UPDATE reference_cdc_v2_profile_bindings
  SET state='ACTIVE',activated_at=clock_timestamp()
WHERE source_instance_id='test-source' AND profile_version='test-v2';

DO $$
BEGIN
  BEGIN
    INSERT INTO reference_cdc_v2_profile_bindings
      (source_instance_id,profile_id,profile_version,coverage_epoch_id,
       activation_at,state,decision_ref,activated_at)
    VALUES
      ('test-source','reference-commerce-current-state','test-v3',
       'test-epoch','2026-10-30T04:29:31.042Z','ACTIVE','test-only',clock_timestamp());
    RAISE EXCEPTION 'second active profile unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> '23505' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE reference_cdc_v2_profile_releases
      SET definition='{}'::jsonb WHERE profile_version='test-v2';
    RAISE EXCEPTION 'release mutation unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'reference CDC profile releases are immutable; publish a new version'
      THEN RAISE; END IF;
  END;
END $$;

SELECT CASE WHEN count(*)=1 AND bool_and(state='ACTIVE')
  THEN 'PROFILE_BINDING_GUARD_PASS' ELSE 'PROFILE_BINDING_GUARD_FAIL' END
FROM reference_cdc_v2_profile_bindings WHERE source_instance_id='test-source';
SELECT CASE WHEN array_agg(new_state ORDER BY audit_id) = ARRAY['SHADOW','ACTIVE']::text[]
  THEN 'PROFILE_AUDIT_PASS' ELSE 'PROFILE_AUDIT_FAIL' END
FROM reference_cdc_v2_profile_binding_audit WHERE source_instance_id='test-source';
ROLLBACK;
