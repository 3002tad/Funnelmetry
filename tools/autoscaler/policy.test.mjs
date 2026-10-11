import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, initialState, validateConfig } from './policy.mjs';
const config = { project: 'scale-test', service: 'canonical-normalizer', groupId: 'test-group',
  minReplicas: 1, maxReplicas: 4, upLag: '100', downLag: '5', upWindowMs: 10,
  downWindowMs: 30, cooldownMs: 100, maxSampleAgeMs: 5, maxGapMs: 20, minSamples: 2 };
const sample = (at, extra = {}) => ({ project: config.project, service: config.service, groupId: config.groupId,
  observedAt: at, lag: '150', replicas: 2, partitions: 4, hostReplicaLimit: 4,
  identityVerified: true, replayVerified: true, gracefulDownVerified: true, ready: true,
  groupStable: true, memberCount: 2, recoveryActive: false, ...extra });
const run = (state, at, extra) => evaluate(config, state, sample(at, extra), at);

test('sustained backlog grows only one replica and latches pending', () => {
  const first = run(initialState(config), 10);
  assert.equal(first.action, 'HOLD');
  const next = run(first.state, 20);
  assert.equal(next.action, 'SCALE_UP');
  assert.equal(next.audit.desiredReplicas, 3);
  assert.equal(run(JSON.parse(JSON.stringify(next.state)), 1000).audit.reason, 'PENDING_ACTION_REQUIRES_RECONCILIATION');
  assert.equal(first.state.pending, false);
});
test('scale down requires longer observation and stops above zero', () => {
  let state = initialState(config);
  for (const at of [10, 20, 30]) { const r = run(state, at, { lag: '0' }); assert.equal(r.action, 'HOLD'); state = r.state; }
  const r = run(state, 40, { lag: '0' });
  assert.equal(r.action, 'SCALE_DOWN');
  assert.equal(r.audit.desiredReplicas, 1);
  assert.equal(run(initialState(config), 10, { lag: '0', replicas: 1, memberCount: 1 }).action, 'HOLD');
});
test('missing/stale/duplicate data, rebalance and recovery do not scale', () => {
  const state = run(initialState(config), 10).state;
  for (const extra of [{ lag: null }, { lag: 150 }, { groupStable: false }, { ready: false },
    { identityVerified: false }, { replayVerified: false }, { recoveryActive: true },
    { memberCount: 1 }, { hostReplicaLimit: null }, { observedAt: 10 }, { observedAt: 30 },
    { observedAt: 11 }, { project: 'other' }]) {
    const r = run(state, 20, extra);
    assert.equal(r.action, 'HOLD'); assert.equal(r.state.samples, 0);
  }
});
test('partition count and host resources cap replicas', () => {
  for (const extra of [{ partitions: 2 }, { hostReplicaLimit: 2 }, { replicas: 4, memberCount: 4 }, { partitions: 1 }]) {
    assert.equal(run(run(initialState(config), 10, extra).state, 20, extra).action, 'HOLD');
  }
});
test('sample gaps and replica changes restart observation window', () => {
  const state = run(initialState(config), 10).state;
  assert.equal(run(state, 40).audit.reason, 'OBSERVATION_WINDOW');
  assert.equal(run(state, 20, { replicas: 3, memberCount: 3 }).audit.reason, 'OBSERVATION_WINDOW');
});
test('cooldown and unverified graceful drain block changes', () => {
  assert.equal(run({ ...initialState(config), lastDecisionAt: 5 }, 20).audit.reason, 'COOLDOWN');
  assert.equal(run(initialState(config), 10, { lag: '0', gracefulDownVerified: false }).action, 'HOLD');
});
test('large lag retains exact integer meaning', () => {
  const c = { ...config, upLag: '9007199254740993' };
  const s = sample(10, { lag: '9007199254740992' });
  assert.equal(evaluate(c, initialState(c), s, 10).audit.reason, 'HYSTERESIS_BAND');
});
test('non-worker targets, implicit thresholds, zero replica and corrupt binding rejected', () => {
  for (const service of ['postgres', 'kafka', 'qdrant', 'source-connector']) assert.throws(() => validateConfig({ ...config, service }));
  assert.throws(() => validateConfig({ ...config, minReplicas: 0 }));
  assert.throws(() => validateConfig({ ...config, upWindowMs: undefined }));
  assert.throws(() => evaluate({ ...config, maxReplicas: 5 }, initialState(config), sample(10), 10));
  assert.throws(() => run({ ...initialState(config), lastDecisionAt: 30 }, 20));
});
