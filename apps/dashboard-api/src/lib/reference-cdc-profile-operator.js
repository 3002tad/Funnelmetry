import { isDeepStrictEqual } from 'node:util';
import { REFERENCE_CDC_PROFILE_V2 as profile } from './reference-cdc-profile-v2.js';

const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('reference-cdc-v2-profile-binding'))";
const RELEASE_SQL = `SELECT profile_id,profile_version,contract_id,metric_id,definition
  FROM reference_cdc_v2_profile_releases WHERE profile_id=$1 AND profile_version=$2`;
const BINDING_SQL = `SELECT source_instance_id,profile_id,profile_version,
  coverage_epoch_id,activation_at,state,decision_ref,activated_at
  FROM reference_cdc_v2_profile_bindings
  WHERE source_instance_id=$1 AND profile_id=$2 AND profile_version=$3`;
const QUALITY_SQL = `SELECT status,baseline_complete,historical_gap_status,valid_until
  FROM reference_cdc_v2_quality_state
  WHERE source_instance_id=$1 AND coverage_epoch_id=$2`;

function validScope({ sourceId, coverageEpochId, activationAt, decisionRef }) {
  const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (sourceId !== 'medusa-reference' || !id.test(coverageEpochId ?? '') ||
      typeof decisionRef !== 'string' || !/^DEC-[0-9]+(?:[/:._ A-Za-z0-9-]{0,160})$/.test(decisionRef) ||
      typeof activationAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(activationAt) ||
      Number.isNaN(Date.parse(activationAt))) throw Error('reference_profile_scope_invalid');
  return { sourceId, coverageEpochId, activationAt: new Date(activationAt).toISOString(), decisionRef };
}

function exactRelease(row) {
  return row?.profile_id === profile.profile_id &&
    row.profile_version === profile.profile_version &&
    row.contract_id === profile.contract_id && row.metric_id === profile.metric_id &&
    isDeepStrictEqual(row.definition, profile);
}

function sameBinding(row, scope) {
  return row?.source_instance_id === scope.sourceId &&
    row.profile_id === profile.profile_id && row.profile_version === profile.profile_version &&
    row.coverage_epoch_id === scope.coverageEpochId &&
    new Date(row.activation_at).getTime() === Date.parse(scope.activationAt);
}

async function assertQuality(client, scope, now) {
  const quality = (await client.query(QUALITY_SQL,
    [scope.sourceId, scope.coverageEpochId])).rows[0];
  if (quality?.status !== 'CURRENT_STATE_READY' || quality.baseline_complete !== true ||
      quality.historical_gap_status !== 'INCOMPLETE' ||
      !quality.valid_until || new Date(quality.valid_until) <= now()) {
    throw Error('reference_profile_quality_not_ready');
  }
}

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query(LOCK_SQL);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function createReferenceProfileOperator({ pool, now = () => new Date() } = {}) {
  if (!pool?.connect) throw Error('reference_profile_pool_required');
  return Object.freeze({
    async publishShadow(input) {
      const scope = validScope(input);
      return inTransaction(pool, async client => {
        await assertQuality(client, scope, now);
        const baseline = (await client.query(`SELECT max(ingested_at) AS completed_at
          FROM reference_cdc_v2_record_inbox
          WHERE source_instance_id=$1 AND coverage_epoch_id=$2
            AND record_type='BASELINE_COMPLETE'`,
        [scope.sourceId, scope.coverageEpochId])).rows[0]?.completed_at;
        if (!baseline || Date.parse(scope.activationAt) <= new Date(baseline).getTime()) {
          throw Error('reference_profile_activation_not_after_baseline');
        }
        await client.query(`INSERT INTO reference_cdc_v2_profile_releases
          (profile_id,profile_version,contract_id,metric_id,definition)
          VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,
        [profile.profile_id,profile.profile_version,profile.contract_id,profile.metric_id,
          JSON.stringify(profile)]);
        const release = (await client.query(RELEASE_SQL,
          [profile.profile_id,profile.profile_version])).rows[0];
        if (!exactRelease(release)) throw Error('reference_profile_release_conflict');
        await client.query(`INSERT INTO reference_cdc_v2_profile_bindings
          (source_instance_id,profile_id,profile_version,coverage_epoch_id,
           activation_at,state,decision_ref)
          VALUES($1,$2,$3,$4,$5,'SHADOW',$6) ON CONFLICT DO NOTHING`,
        [scope.sourceId,profile.profile_id,profile.profile_version,
          scope.coverageEpochId,scope.activationAt,scope.decisionRef]);
        const binding = (await client.query(BINDING_SQL,
          [scope.sourceId,profile.profile_id,profile.profile_version])).rows[0];
        if (!sameBinding(binding, scope) || binding.state === 'ROLLED_BACK') {
          throw Error('reference_profile_binding_conflict');
        }
        return { status: binding.state, profile_id: profile.profile_id,
          profile_version: profile.profile_version, coverage_epoch_id: scope.coverageEpochId };
      });
    },
    async activate(input) {
      const scope = validScope(input);
      return inTransaction(pool, async client => {
        await assertQuality(client, scope, now);
        const release = (await client.query(RELEASE_SQL,
          [profile.profile_id,profile.profile_version])).rows[0];
        if (!exactRelease(release)) throw Error('reference_profile_release_unverified');
        const binding = (await client.query(BINDING_SQL,
          [scope.sourceId,profile.profile_id,profile.profile_version])).rows[0];
        if (!sameBinding(binding, scope) || !['SHADOW','ACTIVE'].includes(binding.state)) {
          throw Error('reference_profile_binding_unverified');
        }
        if (binding.state === 'SHADOW') await client.query(`UPDATE reference_cdc_v2_profile_bindings
          SET state='ACTIVE',activated_at=clock_timestamp(),decision_ref=$4,
              updated_at=clock_timestamp()
          WHERE source_instance_id=$1 AND profile_id=$2 AND profile_version=$3
            AND state='SHADOW'`,
        [scope.sourceId,profile.profile_id,profile.profile_version,scope.decisionRef]);
        return { status: 'ACTIVE', profile_id: profile.profile_id,
          profile_version: profile.profile_version, coverage_epoch_id: scope.coverageEpochId };
      });
    },
    async rollback(input) {
      const scope = validScope(input);
      return inTransaction(pool, async client => {
        const binding = (await client.query(BINDING_SQL,
          [scope.sourceId,profile.profile_id,profile.profile_version])).rows[0];
        if (!sameBinding(binding, scope)) throw Error('reference_profile_binding_unverified');
        if (binding.state !== 'ROLLED_BACK') await client.query(`UPDATE reference_cdc_v2_profile_bindings
          SET state='ROLLED_BACK',decision_ref=$4,updated_at=clock_timestamp()
          WHERE source_instance_id=$1 AND profile_id=$2 AND profile_version=$3
            AND state IN ('SHADOW','ACTIVE')`,
        [scope.sourceId,profile.profile_id,profile.profile_version,scope.decisionRef]);
        return { status: 'ROLLED_BACK',
          profile_id: profile.profile_id, profile_version: profile.profile_version };
      });
    },
  });
}
