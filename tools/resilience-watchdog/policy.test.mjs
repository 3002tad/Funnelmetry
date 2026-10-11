import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, initialState, validatePolicy } from './policy.mjs';

// Test timings only, not production defaults or an approved SLA.
const policy = { project: 'isolated-test', services: ['canonical-normalizer'],
  failureThreshold: 2, startupGraceMs: 10, cooldownMs: 20, maxAttempts: 2,
  windowMs: 1000, maxSampleAgeMs: 5 };
const fresh = () => initialState(policy.project, policy.services[0]);
const sample = (at, extra = {}) => ({ project: policy.project, service: policy.services[0],
  oneoff: false, running: true, observedAt: at, startedAt: 0,
  liveness: 'failed', readiness: false, ...extra });
const step = (state, at, extra) => evaluate(policy, state, sample(at, extra), at);

test('no implicit thresholds or stateful service allowlist', () => {
  assert.throws(() => validatePolicy({ ...policy, cooldownMs: undefined }));
  for (const service of ['postgres', 'kafka', 'qdrant', 'dashboard-api', 'source-connector']) {
    assert.throws(() => validatePolicy({ ...policy, services: [service] }));
  }
});
test('dependency outage never triggers restart', () => {
  let state = fresh();
  for (let at = 20; at < 200; at++) {
    const result = step(state, at, { liveness: 'alive' });
    assert.equal(result.action, 'NONE');
    assert.equal(result.audit.reason, 'DEPENDENCY_NOT_READY');
    state = result.state;
  }
  assert.deepEqual(state.attempts, []);
});
test('unknown liveness, foreign project, stopped, oneoff and startup fail closed', () => {
  for (const extra of [{ liveness: 'unknown' }, { project: 'other' }, { running: false },
    { oneoff: true }, { startedAt: 19 }, { startedAt: 40 }]) {
    const result = step({ ...fresh(), failures: 1 }, 20, extra);
    assert.equal(result.action, 'NONE');
    assert.equal(result.state.failures, 0);
  }
});
test('stale, duplicate and future samples do not count', () => {
  const first = step(fresh(), 20).state;
  for (const at of [10, 20, 31]) {
    const result = evaluate(policy, first, sample(at), 30);
    assert.equal(result.action, 'NONE');
    assert.equal(result.audit.reason, 'STALE_OR_REPEATED_OBSERVATION');
  }
});
test('threshold reserves restart budget without mutating input; cooldown blocks repeated action', () => {
  const first = step(fresh(), 20).state;
  const next = step(first, 21);
  assert.equal(next.action, 'RESTART');
  assert.deepEqual(first.attempts, []);
  assert.deepEqual(next.state.attempts, [21]);
  const cooldown = step(step(next.state, 22).state, 23);
  assert.equal(cooldown.action, 'NONE');
  assert.equal(cooldown.audit.reason, 'COOLDOWN');
});
test('restart/reload keeps budget; exhaustion latches until operator review', () => {
  let state = fresh();
  const actions = [];
  for (const at of [20, 21, 42, 43, 64, 65]) {
    const result = step(JSON.parse(JSON.stringify(state)), at);
    actions.push(result.action);
    state = result.state;
  }
  assert.equal(actions.filter(action => action === 'RESTART').length, 2);
  assert.equal(state.circuitOpen, true);
  const later = step(state, 5000, { liveness: 'alive', readiness: true });
  assert.equal(later.audit.reason, 'CIRCUIT_OPEN_OPERATOR_REVIEW');
});
test('healthy observation resets failures but not attempt history', () => {
  const state = { ...fresh(), failures: 1, attempts: [15] };
  const result = step(state, 20, { liveness: 'alive', readiness: true });
  assert.equal(result.state.status, 'HEALTHY');
  assert.equal(result.state.failures, 0);
  assert.deepEqual(result.state.attempts, [15]);
});
test('corrupt state and backward recovery clock are rejected instead of resetting budget', () => {
  for (const state of [null, { ...fresh(), attempts: [30] }, { ...fresh(), project: 'other' },
    { ...fresh(), failures: -1 }, { ...fresh(), attempts: [18, 15] }]) {
    assert.throws(() => step(state, 20));
  }
});
