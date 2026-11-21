// Generate reviewable, transactional v2 <-> v3 switch SQL. Does not execute it.
import {REFERENCE_CDC_PROFILE_V2 as oldProfile} from '../../apps/dashboard-api/src/lib/reference-cdc-profile-v2.js'
import {REFERENCE_CDC_PROFILE_V3 as newProfile} from '../../apps/dashboard-api/src/lib/reference-cdc-profile-v3.js'
import {writeFileSync} from 'node:fs'
const literal=value=>"'"+String(value).replaceAll("'","''")+"'"
export function switchSql({rollback=false}={}) {
  const from=rollback?newProfile:oldProfile,to=rollback?oldProfile:newProfile
  const ref=literal('USER-2026-11-19 cart-linkage repair / '+(rollback?'rollback to v2':'explicit-page-cart-bridge-v3')+' / Backbone 19.2-19.3')
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtext('reference-cdc-v2-profile-binding'));
DO $switch$
DECLARE previous reference_cdc_v2_profile_bindings%ROWTYPE;
BEGIN
  SELECT * INTO STRICT previous FROM reference_cdc_v2_profile_bindings
    WHERE source_instance_id='medusa-reference' AND state='ACTIVE' FOR UPDATE;
  IF previous.profile_id<>${literal(from.profile_id)} OR previous.profile_version<>${literal(from.profile_version)} THEN
    RAISE EXCEPTION 'Unexpected active profile; refusing switch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM reference_cdc_v2_profile_releases
    WHERE profile_id=previous.profile_id AND profile_version=previous.profile_version
    AND definition=${literal(JSON.stringify(from))}::jsonb) THEN
    RAISE EXCEPTION 'Active definition mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM reference_cdc_v2_quality_state
    WHERE source_instance_id=previous.source_instance_id AND coverage_epoch_id=previous.coverage_epoch_id
    AND status='CURRENT_STATE_READY' AND baseline_complete AND historical_gap_status='INCOMPLETE'
    AND verified_at<=clock_timestamp() AND valid_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'Fresh complete quality lease required';
  END IF;
  INSERT INTO reference_cdc_v2_profile_releases(profile_id,profile_version,contract_id,metric_id,definition)
    VALUES(${literal(to.profile_id)},${literal(to.profile_version)},${literal(to.contract_id)},${literal(to.metric_id)},${literal(JSON.stringify(to))}::jsonb)
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM reference_cdc_v2_profile_releases
    WHERE profile_id=${literal(to.profile_id)} AND profile_version=${literal(to.profile_version)}
    AND contract_id=${literal(to.contract_id)} AND metric_id=${literal(to.metric_id)}
    AND definition=${literal(JSON.stringify(to))}::jsonb) THEN RAISE EXCEPTION 'Target definition mismatch'; END IF;
  INSERT INTO reference_cdc_v2_profile_bindings(source_instance_id,profile_id,profile_version,coverage_epoch_id,activation_at,state,decision_ref)
    VALUES(previous.source_instance_id,${literal(to.profile_id)},${literal(to.profile_version)},previous.coverage_epoch_id,previous.activation_at,'SHADOW',${ref})
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM reference_cdc_v2_profile_bindings
    WHERE source_instance_id=previous.source_instance_id AND profile_id=${literal(to.profile_id)} AND profile_version=${literal(to.profile_version)}
    AND coverage_epoch_id=previous.coverage_epoch_id AND activation_at=previous.activation_at AND state='SHADOW') THEN
    RAISE EXCEPTION 'Target binding not compatible';
  END IF;
  UPDATE reference_cdc_v2_profile_bindings SET state='SHADOW',decision_ref=${ref},updated_at=clock_timestamp()
    WHERE source_instance_id=previous.source_instance_id AND profile_id=previous.profile_id AND profile_version=previous.profile_version;
  UPDATE reference_cdc_v2_profile_bindings SET state='ACTIVE',activated_at=clock_timestamp(),decision_ref=${ref},updated_at=clock_timestamp()
    WHERE source_instance_id=previous.source_instance_id AND profile_id=${literal(to.profile_id)} AND profile_version=${literal(to.profile_version)};
END;
$switch$;
COMMIT;
SELECT profile_id,profile_version,state,coverage_epoch_id FROM reference_cdc_v2_profile_bindings WHERE source_instance_id='medusa-reference' ORDER BY profile_version;
`
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/bridge-release.mjs')){
  const output=process.argv[2];if(!output)throw Error('Output SQL path required')
  writeFileSync(output,switchSql({rollback:process.argv.includes('--rollback')}))
}
