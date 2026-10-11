// Decision-only prototype. No Docker calls; input is a trusted, coherent host snapshot.
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value);
export function validateConfig(c) {
  if (!c || !/^[a-z0-9][a-z0-9_-]+$/.test(c.project || '') ||
      c.service !== 'canonical-normalizer' || typeof c.groupId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(c.groupId)) {
    throw Error('Explicit project/group and supported service required');
  }
  for (const name of ['minReplicas', 'maxReplicas', 'upWindowMs', 'downWindowMs',
    'cooldownMs', 'maxSampleAgeMs', 'maxGapMs', 'minSamples']) {
    if (!nonnegative(c[name]) || c[name] === 0) throw Error(`Invalid ${name}`);
  }
  if (c.minReplicas > c.maxReplicas || c.downWindowMs <= c.upWindowMs || c.minSamples < 2 ||
      !decimal(c.upLag) || !decimal(c.downLag) || BigInt(c.upLag) <= BigInt(c.downLag)) {
    throw Error('Invalid limits/hysteresis');
  }
}
export function initialState(c) {
  validateConfig(c);
  return { version: 1, binding: JSON.stringify(c), lastObservedAt: null, lastDecisionAt: null,
    direction: null, since: null, samples: 0, replicas: null, pending: false };
}

export function evaluate(c, previous, observation, now) {
  validateConfig(c);
  if (!nonnegative(now) || !previous || previous.version !== 1 || previous.binding !== JSON.stringify(c) ||
      !nonnegative(previous.samples) || ![null, 'UP', 'DOWN'].includes(previous.direction) ||
      typeof previous.pending !== 'boolean') throw Error('Invalid state/config; do not reset implicitly');
  for (const key of ['lastObservedAt', 'lastDecisionAt', 'since']) {
    if (previous[key] !== null && (!nonnegative(previous[key]) || previous[key] > now)) throw Error('Invalid state clock');
  }
  if (previous.replicas !== null && (!nonnegative(previous.replicas) || previous.replicas < 1)) throw Error('Invalid state replicas');
  const state = structuredClone(previous);
  const s = observation || {};
  const clear = () => { state.direction = null; state.since = null; state.samples = 0; };
  const result = (reason, action = 'HOLD', desired = s.replicas) => ({ state, action,
    audit: { project: c.project, service: c.service, groupId: c.groupId, at: now,
      signal: 'kafka_lag', observedValue: decimal(s.lag) ? s.lag : null,
      previousReplicas: nonnegative(s.replicas) ? s.replicas : null,
      desiredReplicas: nonnegative(desired) ? desired : null, reason, result: 'DECISION_ONLY' } });
  const hold = reason => { clear(); return result(reason); };
  if (state.pending) return hold('PENDING_ACTION_REQUIRES_RECONCILIATION');
  if (s.project !== c.project || s.service !== c.service || s.groupId !== c.groupId) return hold('SCOPE_MISMATCH');
  if (!nonnegative(s.observedAt) || s.observedAt > now || now - s.observedAt > c.maxSampleAgeMs ||
      (state.lastObservedAt !== null && s.observedAt <= state.lastObservedAt)) return hold('STALE_OR_REPEATED_SAMPLE');
  const gap = state.lastObservedAt !== null && s.observedAt - state.lastObservedAt > c.maxGapMs;
  state.lastObservedAt = s.observedAt;
  if (gap) clear();
  if (!decimal(s.lag) || !nonnegative(s.replicas) || s.replicas < 1 ||
      !nonnegative(s.partitions) || s.partitions < 1 || !nonnegative(s.hostReplicaLimit) || s.hostReplicaLimit < 1) {
    return hold('UNKNOWN_WORKLOAD_OR_CAPACITY');
  }
  if (state.replicas !== s.replicas) clear();
  state.replicas = s.replicas;
  // All are evidence gates; not values the user/Agent can assert to authorize scaling.
  if (s.identityVerified !== true || s.replayVerified !== true) return hold('REPLICA_SAFETY_UNVERIFIED');
  if (s.ready !== true || s.groupStable !== true || s.memberCount !== s.replicas || s.recoveryActive !== false) {
    return hold('UNHEALTHY_REBALANCING_OR_RECOVERING');
  }
  const ceiling = Math.min(c.maxReplicas, s.partitions, s.hostReplicaLimit);
  if (ceiling < c.minReplicas || s.replicas < c.minReplicas || s.replicas > ceiling) return hold('CAPACITY_OR_REPLICA_DRIFT');
  if (state.lastDecisionAt !== null && now - state.lastDecisionAt < c.cooldownMs) return hold('COOLDOWN');
  const direction = BigInt(s.lag) >= BigInt(c.upLag) ? 'UP' : BigInt(s.lag) <= BigInt(c.downLag) ? 'DOWN' : null;
  if (!direction) return hold('HYSTERESIS_BAND');
  if (direction === 'UP' && s.replicas >= ceiling) return hold('PARTITION_HOST_OR_MAX_LIMIT');
  if (direction === 'DOWN' && (s.replicas <= c.minReplicas || s.gracefulDownVerified !== true)) return hold('MINIMUM_OR_DRAIN_UNVERIFIED');
  if (state.direction !== direction) { state.direction = direction; state.since = s.observedAt; state.samples = 0; }
  state.samples = Math.min(state.samples + 1, c.minSamples);
  const window = direction === 'UP' ? c.upWindowMs : c.downWindowMs;
  if (state.samples < c.minSamples || s.observedAt - state.since < window) return result('OBSERVATION_WINDOW');
  state.lastDecisionAt = now;
  state.pending = true; // must reconcile actual result before another decision; no reset API yet
  clear();
  return result(direction === 'UP' ? 'SUSTAINED_BACKLOG' : 'SUSTAINED_LOW_BACKLOG',
    direction === 'UP' ? 'SCALE_UP' : 'SCALE_DOWN', s.replicas + (direction === 'UP' ? 1 : -1));
}
