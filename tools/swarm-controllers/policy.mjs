// DEC-130 Level-2 policy. Swarm owns failed tasks and failed liveness checks;
// this policy acts only on a running task whose application remains not ready.
export const RECOVERY_ALLOWLIST = Object.freeze([
  'canonical-normalizer', 'canonical-ledger-writer', 'ingress-telemetry-writer',
  'traffic-source-writer', 'journey-processor', 'funnel-processor', 'kpi-projector',
]);

const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;

export function validateRecoveryPolicy(config) {
  if (!config || !RECOVERY_ALLOWLIST.includes(config.service)) throw Error('Unsupported recovery service');
  for (const key of ['failureThreshold', 'cooldownMs', 'windowMs', 'maxAttempts',
    'startupGraceMs', 'maxSampleAgeMs']) {
    if (!integer(config[key], key === 'startupGraceMs' ? 0 : 1)) throw Error(`Invalid ${key}`);
  }
  if (config.windowMs < config.cooldownMs) throw Error('Recovery window must cover cooldown');
}

export function initialRecoveryState(config) {
  validateRecoveryPolicy(config);
  return { version: 1, lastObservedAt: null, taskId: null, failures: 0,
    attempts: [], circuitOpen: false, pending: null, status: 'DEGRADED' };
}

export function evaluateRecovery(config, previous, sample, now) {
  validateRecoveryPolicy(config);
  if (!integer(now) || !previous || previous.version !== 1 ||
    !integer(previous.failures) || !Array.isArray(previous.attempts) ||
    typeof previous.circuitOpen !== 'boolean' ||
    (previous.lastObservedAt !== null && (!integer(previous.lastObservedAt) || previous.lastObservedAt > now)) ||
    previous.attempts.some((at, i) => !integer(at) || at > now || (i && at < previous.attempts[i - 1]))) {
    throw Error('Invalid recovery state');
  }
  const state = structuredClone(previous);
  const result = (reason, status = 'DEGRADED', action = 'HOLD') => {
    state.status = status;
    return { state, action, audit: { service: config.service, at: now, reason, status, action,
      taskId: sample?.taskId ?? null, result: 'DECISION_ONLY' } };
  };
  if (state.pending) return result('UNCERTAIN_ACTION_OPERATOR_REVIEW');
  if (state.circuitOpen) return result('CIRCUIT_OPEN_OPERATOR_REVIEW');
  if (!sample || sample.service !== config.service || !integer(sample.observedAt) ||
    sample.observedAt > now || now - sample.observedAt > config.maxSampleAgeMs ||
    (state.lastObservedAt !== null && sample.observedAt <= state.lastObservedAt)) {
    state.failures = 0;
    return result('STALE_OR_SCOPE_MISMATCH');
  }
  state.lastObservedAt = sample.observedAt;
  if (sample.running !== true || sample.desiredReplicas !== 1 || sample.runningReplicas !== 1 ||
    sample.updating === true || !/^[a-z0-9]{20,}$/.test(sample.taskId || '')) {
    state.failures = 0;
    return result('SWARM_RECONCILING_OR_TARGET_UNVERIFIED');
  }
  if (state.taskId !== sample.taskId) { state.taskId = sample.taskId; state.failures = 0; }
  if (!integer(sample.startedAt) || sample.startedAt > sample.observedAt ||
    sample.observedAt - sample.startedAt < config.startupGraceMs) {
    state.failures = 0;
    return result('STARTUP_GRACE');
  }
  if (sample.liveness !== 'alive') {
    state.failures = 0;
    return result('LIVENESS_OR_TASK_FAILURE_OWNED_BY_SWARM');
  }
  if (sample.readiness === true) {
    state.failures = 0;
    return result('LIVE_AND_READY', 'HEALTHY');
  }
  if (sample.dependenciesReady !== true) {
    state.failures = 0;
    return result('DEPENDENCY_DEGRADED_NO_RESTART');
  }
  state.failures = Math.min(state.failures + 1, config.failureThreshold);
  if (state.failures < config.failureThreshold) return result('WAIT_FAILURE_THRESHOLD', 'UNHEALTHY');
  const last = state.attempts.at(-1);
  if (last !== undefined && now - last < config.cooldownMs) return result('COOLDOWN', 'RECOVERING');
  state.attempts = state.attempts.filter(at => now - at < config.windowMs);
  if (state.attempts.length >= config.maxAttempts) {
    state.circuitOpen = true;
    return result('RECOVERY_BUDGET_EXHAUSTED');
  }
  state.attempts.push(now);
  state.failures = 0;
  return result('APPLICATION_NOT_READY_DEPENDENCIES_READY', 'RECOVERING', 'FORCE_UPDATE');
}
