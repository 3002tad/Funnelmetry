import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecovery, initialRecoveryState } from './policy.mjs';

const config = { service: 'canonical-normalizer', failureThreshold: 2, cooldownMs: 100,
  windowMs: 500, maxAttempts: 2, startupGraceMs: 10, maxSampleAgeMs: 20 };
const sample = (at, extra = {}) => ({ service: config.service, observedAt: at,
  taskId: 'a'.repeat(25), startedAt: 0, running: true, desiredReplicas: 1,
  runningReplicas: 1, updating: false, liveness: 'alive', readiness: false,
  dependenciesReady: true, ...extra });

test('only sustained application readiness failure reserves Level-2 action', () => {
  const first = evaluateRecovery(config, initialRecoveryState(config), sample(20), 20);
  assert.equal(first.action, 'HOLD');
  const second = evaluateRecovery(config, first.state, sample(30), 30);
  assert.equal(second.action, 'FORCE_UPDATE');
  assert.equal(second.state.attempts.length, 1);
  const third = evaluateRecovery(config, second.state, sample(40), 40);
  assert.equal(third.audit.reason, 'WAIT_FAILURE_THRESHOLD');
  assert.equal(evaluateRecovery(config, third.state, sample(50), 50).audit.reason, 'COOLDOWN');
});

test('Swarm task/liveness failure, dependency outage and healthy probe never force update', () => {
  for (const extra of [{ running: false }, { runningReplicas: 0 }, { updating: true },
    { liveness: 'unknown' }, { liveness: 'failed' }, { dependenciesReady: false },
    { readiness: true }, { observedAt: 0 }]) {
    let state = initialRecoveryState(config);
    for (const at of [20, 30]) {
      const result = evaluateRecovery(config, state, sample(at, extra), at);
      assert.equal(result.action, 'HOLD');
      state = result.state;
    }
  }
});

test('circuit budget and task replacement prevent restart loops', () => {
  let state = initialRecoveryState(config);
  for (const at of [20, 30, 140, 150]) state = evaluateRecovery(config, state, sample(at), at).state;
  assert.equal(state.attempts.length, 2);
  state = evaluateRecovery(config, state, sample(260), 260).state;
  const exhausted = evaluateRecovery(config, state, sample(270), 270);
  assert.equal(exhausted.audit.reason, 'RECOVERY_BUDGET_EXHAUSTED');
  assert.equal(exhausted.state.circuitOpen, true);
  assert.equal(evaluateRecovery(config, exhausted.state, sample(400), 400).action, 'HOLD');
  const replaced = evaluateRecovery(config, { ...initialRecoveryState(config), taskId: 'a'.repeat(25), failures: 1 },
    sample(20, { taskId: 'b'.repeat(25) }), 20);
  assert.equal(replaced.action, 'HOLD');
});

test('policy rejects unsafe scope, implicit thresholds and corrupt clock', () => {
  assert.throws(() => initialRecoveryState({ ...config, service: 'kafka' }));
  assert.throws(() => initialRecoveryState({ ...config, cooldownMs: undefined }));
  assert.throws(() => evaluateRecovery(config, { ...initialRecoveryState(config), lastObservedAt: 100 }, sample(20), 20));
});
