// Pure policy only: no Docker access. Persist returned state before any actuator action.
export const WORKER_ALLOWLIST = Object.freeze([
  'canonical-normalizer', 'canonical-ledger-writer', 'ingress-telemetry-writer',
  'journey-processor', 'funnel-processor', 'kpi-projector',
]);

const integer = (value, name, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
};

export function validatePolicy(policy) {
  if (!policy || typeof policy.project !== 'string' || !/^[a-z0-9][a-z0-9_-]+$/.test(policy.project)) {
    throw new Error('Explicit Compose project required');
  }
  if (!Array.isArray(policy.services) || !policy.services.length ||
      new Set(policy.services).size !== policy.services.length ||
      policy.services.some(service => !WORKER_ALLOWLIST.includes(service))) {
    throw new Error('Only explicitly selected supported workers are allowed');
  }
  for (const name of ['failureThreshold', 'cooldownMs', 'maxAttempts', 'windowMs', 'maxSampleAgeMs']) {
    integer(policy[name], name, 1);
  }
  integer(policy.startupGraceMs, 'startupGraceMs');
  if (policy.windowMs < policy.cooldownMs) throw new Error('Window must cover cooldown');
}

export function initialState(project, service) {
  return { version: 1, project, service, lastObservedAt: null, failures: 0,
    attempts: [], circuitOpen: false, status: 'DEGRADED' };
}

function validateState(state, policy, service, now) {
  if (!state || state.version !== 1 || state.project !== policy.project || state.service !== service ||
      typeof state.circuitOpen !== 'boolean' || !Array.isArray(state.attempts) ||
      !['HEALTHY', 'UNHEALTHY', 'RECOVERING', 'DEGRADED'].includes(state.status)) {
    throw new Error('Invalid recovery state; never reset automatically');
  }
  integer(state.failures, 'failures');
  if (state.lastObservedAt !== null) {
    integer(state.lastObservedAt, 'lastObservedAt');
    if (state.lastObservedAt > now) throw new Error('Recovery clock/state inconsistent');
  }
  for (let i = 0; i < state.attempts.length; i++) {
    integer(state.attempts[i], 'attempt');
    if (state.attempts[i] > now || (i > 0 && state.attempts[i] < state.attempts[i - 1])) {
      throw new Error('Recovery clock/state inconsistent');
    }
  }
}

/** observation comes from a trusted host probe, never UI/Agent input.
 * liveness: alive | failed | unknown. Docker readiness unhealthy is NOT failed liveness.
 * A RESTART decision reserves budget, even if the subsequent actuator fails.
 */
export function evaluate(policy, previous, observation, now) {
  validatePolicy(policy);
  integer(now, 'now');
  const sample = observation ?? {};
  if (!policy.services.includes(sample.service)) throw new Error('Service outside policy');
  validateState(previous, policy, sample.service, now);
  const state = structuredClone(previous);
  const result = (reason, status = 'DEGRADED', action = 'NONE') => {
    state.status = status;
    return { state, action, audit: { project: policy.project, service: sample.service,
      at: now, reason, status, action } };
  };
  if (state.circuitOpen) return result('CIRCUIT_OPEN_OPERATOR_REVIEW');
  if (sample.project !== policy.project || sample.oneoff !== false || sample.running !== true) {
    state.failures = 0;
    return result('TARGET_NOT_ELIGIBLE');
  }
  if (!Number.isSafeInteger(sample.observedAt) || sample.observedAt < 0 || sample.observedAt > now ||
      now - sample.observedAt > policy.maxSampleAgeMs ||
      (state.lastObservedAt !== null && sample.observedAt <= state.lastObservedAt)) {
    state.failures = 0;
    return result('STALE_OR_REPEATED_OBSERVATION');
  }
  state.lastObservedAt = sample.observedAt;
  if (!Number.isSafeInteger(sample.startedAt) || sample.startedAt < 0 ||
      sample.startedAt > sample.observedAt || sample.observedAt - sample.startedAt < policy.startupGraceMs) {
    state.failures = 0;
    return result('STARTUP_GRACE_OR_UNKNOWN');
  }
  if (sample.liveness === 'alive') {
    state.failures = 0;
    return sample.readiness === true
      ? result('LIVE_AND_READY', 'HEALTHY') : result('DEPENDENCY_NOT_READY');
  }
  if (sample.liveness !== 'failed') {
    state.failures = 0;
    return result('LIVENESS_UNVERIFIED');
  }
  state.failures = Math.min(state.failures + 1, policy.failureThreshold);
  if (state.failures < policy.failureThreshold) return result('WAIT_FAILURE_THRESHOLD', 'UNHEALTHY');
  const lastAttempt = state.attempts.at(-1);
  if (lastAttempt !== undefined && now - lastAttempt < policy.cooldownMs) {
    return result('COOLDOWN', 'RECOVERING');
  }
  state.attempts = state.attempts.filter(at => now - at < policy.windowMs);
  if (state.attempts.length >= policy.maxAttempts) {
    state.circuitOpen = true;
    return result('RECOVERY_BUDGET_EXHAUSTED');
  }
  state.attempts.push(now);
  state.failures = 0;
  return result('LIVENESS_FAILURE_RESTART_RESERVED', 'RECOVERING', 'RESTART');
}
