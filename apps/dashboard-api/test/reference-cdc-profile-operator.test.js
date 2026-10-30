import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceProfileOperator } from '../src/lib/reference-cdc-profile-operator.js';
import { REFERENCE_CDC_PROFILE_V2 as profile } from '../src/lib/reference-cdc-profile-v2.js';

const scope = { sourceId: 'medusa-reference', coverageEpochId: 'cdc11_order_epoch1',
  activationAt: '2026-10-30T04:29:31.042Z', decisionRef: 'DEC-119/135 CDC12 reference cutover' };

function harness({ qualityReady = true, baselineAt = '2026-10-30T04:29:31.041806Z',
  conflictingRelease = false } = {}) {
  let release = null, binding = null;
  const statements = [];
  const client = { release() {}, async query(sql) {
    statements.push(sql);
    if (sql.startsWith('SELECT status,baseline_complete')) return { rows: [{
      status: qualityReady ? 'CURRENT_STATE_READY' : 'BLOCKED_BY_QUALITY',
      baseline_complete: true, historical_gap_status: 'INCOMPLETE',
      valid_until: '2026-10-30T12:01:00Z',
    }] };
    if (sql.includes('max(ingested_at)')) return { rows: [{ completed_at: baselineAt }] };
    if (sql.startsWith('INSERT INTO reference_cdc_v2_profile_releases')) {
      release ??= { profile_id: profile.profile_id, profile_version: profile.profile_version,
        contract_id: profile.contract_id, metric_id: profile.metric_id,
        definition: conflictingRelease ? { invalid: true } : profile };
    }
    if (sql.startsWith('SELECT profile_id,profile_version')) return { rows: release ? [release] : [] };
    if (sql.startsWith('INSERT INTO reference_cdc_v2_profile_bindings')) {
      binding ??= { source_instance_id: scope.sourceId, profile_id: profile.profile_id,
        profile_version: profile.profile_version, coverage_epoch_id: scope.coverageEpochId,
        activation_at: scope.activationAt, state: 'SHADOW' };
    }
    if (sql.startsWith('SELECT source_instance_id,profile_id')) return { rows: binding ? [binding] : [] };
    if (sql.includes("SET state='ACTIVE'")) binding.state = 'ACTIVE';
    if (sql.includes("SET state='ROLLED_BACK'")) binding.state = 'ROLLED_BACK';
    return { rows: [] };
  } };
  const pool = { async connect() { return client; } };
  return { operator: createReferenceProfileOperator({ pool,
    now: () => new Date('2026-10-30T12:00:00Z') }), statements,
    get binding() { return binding; } };
}

test('reference profile publication is separate and activation is explicit', async () => {
  const fixture = harness();
  assert.equal((await fixture.operator.publishShadow(scope)).status, 'SHADOW');
  assert.equal(fixture.binding.state, 'SHADOW');
  assert.equal((await fixture.operator.activate(scope)).status, 'ACTIVE');
  assert.equal(fixture.binding.state, 'ACTIVE');
  assert.equal((await fixture.operator.activate(scope)).status, 'ACTIVE');
  assert.equal((await fixture.operator.rollback(scope)).status, 'ROLLED_BACK');
  assert.equal(fixture.binding.state, 'ROLLED_BACK');
  assert.ok(fixture.statements.every(sql => !/\bfunnel_profiles\b|\bcanonical_events\b/.test(sql)));
});

test('profile cannot publish before baseline or with a changed release definition', async () => {
  const early = harness({ baselineAt: '2026-10-30T04:29:31.042Z' });
  await assert.rejects(early.operator.publishShadow(scope), /activation_not_after_baseline/);
  assert.ok(early.statements.includes('ROLLBACK'));
  await assert.rejects(harness({ conflictingRelease: true }).operator.publishShadow(scope),
    /release_conflict/);
});

test('quality failure blocks profile publication and activation', async () => {
  const blocked = harness({ qualityReady: false });
  await assert.rejects(blocked.operator.publishShadow(scope), /quality_not_ready/);
  await assert.rejects(blocked.operator.activate(scope), /quality_not_ready/);
  assert.equal(blocked.binding, null);
});

test('a shadow release can be rolled back before activation and cannot be silently republished', async () => {
  const fixture = harness();
  await fixture.operator.publishShadow(scope);
  assert.equal((await fixture.operator.rollback(scope)).status, 'ROLLED_BACK');
  assert.equal(fixture.binding.state, 'ROLLED_BACK');
  await assert.rejects(fixture.operator.publishShadow(scope), /binding_conflict/);
  await assert.rejects(fixture.operator.activate(scope), /binding_unverified/);
});
