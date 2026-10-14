// Host-side, opt-in Swarm controllers. Never run inside API/Agent containers.
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, mkdir, rmdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { initialState as initialAutoscaleState, evaluate as evaluateAutoscale,
  validateConfig as validateAutoscale } from '../autoscaler/policy.mjs';
import { initialRecoveryState, evaluateRecovery, validateRecoveryPolicy } from './policy.mjs';
import { capacityLimit, dockerClient, kafkaSummary, validateScope, verifyService } from './docker.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;

export function validateConfig(config) {
  validateScope(config);
  if (config.service !== 'canonical-normalizer') throw Error('Only reviewed canonical-normalizer vertical slice supported');
  if (!integer(config.cpuHeadroomNano, 1) || !integer(config.memoryHeadroomBytes, 1)) {
    throw Error('Explicit positive cluster headroom required');
  }
  validateAutoscale(config.autoscale);
  validateRecoveryPolicy(config.recovery);
  if (config.autoscale.project !== config.stack || config.autoscale.service !== config.service ||
    config.autoscale.groupId !== config.groupId || config.recovery.service !== config.service) {
    throw Error('Controller scopes must match');
  }
  if (config.evidence !== undefined && (config.evidence.image !== config.image ||
    !/^[a-zA-Z0-9._:-]{8,160}$/.test(config.evidence.replayTestRef || '') ||
    !/^[a-zA-Z0-9._:-]{8,160}$/.test(config.evidence.drainTestRef || ''))) {
    throw Error('Release evidence must bind to exact image and reviewed test references');
  }
}

async function durableSave(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(data)); await file.sync(); }
  finally { await file.close(); }
  await rename(temp, path);
  if (process.platform !== 'win32') {
    const dir = await open(dirname(path), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
}

async function locked(path, callback) {
  const lockPath = `${path}.lock`;
  await mkdir(lockPath); // stale lock never stolen automatically
  try { return await callback(); } finally { await rmdir(lockPath); }
}

export async function initialize(config, path) {
  validateConfig(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return locked(path, async () => {
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: 1, fingerprint: hash(config), pending: null,
        recovery: initialRecoveryState(config.recovery), autoscale: initialAutoscaleState(config.autoscale), audit: [] }));
      await file.sync();
    } finally { await file.close(); }
  });
}

// Exact-image handoff only. Never upgrades release evidence or clears a
// pending action/circuit. Old observations cannot count toward a new release.
export async function migrateImageState(oldConfig, newConfig, path,
  { clock = Date.now, verifyRuntime } = {}) {
  validateConfig(oldConfig);
  validateConfig(newConfig);
  if (typeof verifyRuntime !== 'function' || oldConfig.image === newConfig.image) {
    throw Error('IMAGE_MIGRATION_REVIEW_REQUIRED');
  }
  const comparable = structuredClone(newConfig);
  comparable.image = oldConfig.image;
  comparable.evidence = oldConfig.evidence;
  if (JSON.stringify(comparable) !== JSON.stringify(oldConfig) ||
    newConfig.evidence !== undefined) throw Error('IMAGE_MIGRATION_SCOPE_CHANGED');
  if (await sessionExists(path)) throw Error('RUNNER_ACTIVE');
  return locked(path, async () => {
    const data = readState(oldConfig, JSON.parse(await readFile(path, 'utf8')));
    if (data.recovery.pending !== null || data.autoscale.pending === true ||
      data.recovery.circuitOpen === true) throw Error('STATE_REQUIRES_OPERATOR_REVIEW');
    const runtime = await verifyRuntime(newConfig);
    if (runtime.image !== newConfig.image || runtime.stack !== newConfig.stack ||
      runtime.service !== newConfig.service || runtime.replicas < 1) {
      throw Error('RUNTIME_IMAGE_UNVERIFIED');
    }
    const at = clock();
    if (!integer(at) || (data.recovery.lastObservedAt !== null && at < data.recovery.lastObservedAt) ||
      (data.autoscale.lastObservedAt !== null && at < data.autoscale.lastObservedAt)) {
      throw Error('MIGRATION_CLOCK_INVALID');
    }
    const lastDecisionAt = data.autoscale.lastDecisionAt;
    data.fingerprint = hash(newConfig);
    data.autoscale = { ...initialAutoscaleState(newConfig.autoscale), lastDecisionAt };
    data.recovery = { ...data.recovery, lastObservedAt: null, taskId: null,
      failures: 0, status: 'DEGRADED' };
    data.audit = [...data.audit, { kind: 'IMAGE_CONFIG_MIGRATION', at,
      fromImage: oldConfig.image, toImage: newConfig.image,
      result: 'MIGRATED_OBSERVATIONS_RESET_RELEASE_UNVERIFIED' }].slice(-200);
    await durableSave(path, data);
    return { migrated: true, fromImage: oldConfig.image, toImage: newConfig.image,
      auditCount: data.audit.length, releaseVerified: false };
  });
}

function readState(config, data, { allowPending = false } = {}) {
  if (data?.version !== 1 || data.fingerprint !== hash(config) || !Array.isArray(data.audit) ||
    !data.recovery || !data.autoscale || !Object.hasOwn(data, 'pending')) {
    throw Error('STATE_CONFIG_MISMATCH');
  }
  if (!allowPending && data.pending !== null) throw Error('UNCERTAIN_ACTION_OPERATOR_REVIEW');
  return data;
}

async function sessionExists(path) {
  try { await stat(`${path}.session`); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function collect(config, adapter, now = Date.now()) {
  validateConfig(config);
  const before = await adapter.discover();
  const { service, targets } = before;
  const readyTask = targets.length === service.replicas && targets.every(t => t.running === true &&
    Number.isSafeInteger(t.startedAt) && t.health !== 'unhealthy');
  const target = targets.length === 1 ? targets[0] : null;
  const healthChecks = await Promise.all(targets.map(t => adapter.health(t)));
  const health = target ? healthChecks[0] : { liveness: 'unknown', readiness: false };
  let kafka = null, identities = [], hostReplicaLimit = null, memoryPercentMax = null;
  const unavailable = [];
  if (readyTask && targets.length) {
    try { kafka = kafkaSummary(await adapter.kafka(targets[0])); }
    catch { unavailable.push('KAFKA_PROBE'); }
    try { identities = await Promise.all(targets.map(t => adapter.identity(t))); }
    catch { unavailable.push('IDENTITY_PROBE'); }
    if (typeof adapter.memory === 'function') {
      try {
        const readings = await Promise.all(targets.map(t => adapter.memory(t)));
        if (readings.length !== targets.length || readings.some(value =>
          typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) {
          throw Error('Invalid memory sample');
        }
        memoryPercentMax = Math.max(...readings);
      } catch { unavailable.push('MEMORY_PROBE'); }
    } else if (config.autoscale.upMemoryPercent !== undefined) unavailable.push('MEMORY_PROBE');
    try {
      const capacity = await adapter.capacity(service.reservation, service.replicas);
      hostReplicaLimit = capacityLimit(capacity, config.cpuHeadroomNano, config.memoryHeadroomBytes);
    } catch { unavailable.push('CAPACITY_PROBE'); }
  }
  if (kafka === null) unavailable.push('KAFKA_UNVERIFIED');
  if (hostReplicaLimit === null) unavailable.push('CAPACITY_UNVERIFIED');
  const after = await adapter.discover();
  const same = after.service.id === service.id && after.service.version === service.version &&
    JSON.stringify(after.targets.map(t => [t.id, t.taskId, t.startedAt]).sort()) ===
    JSON.stringify(targets.map(t => [t.id, t.taskId, t.startedAt]).sort());
  const identityVerified = readyTask && identities.length === targets.length && identities.every(i =>
    i.mode === 'container' && i.groupId === config.groupId && i.topic === config.topic &&
    typeof i.instanceId === 'string' && typeof i.clientId === 'string') &&
    new Set(identities.map(i => `${i.clientId}-${i.instanceId}`)).size === targets.length;
  const releaseVerified = config.evidence?.image === config.image;
  return {
    service, targets, target, stableTopology: same, unavailable,
    recovery: { service: config.service, observedAt: now, taskId: target?.taskId,
      startedAt: target?.startedAt, running: same && target?.running === true,
      desiredReplicas: service.replicas, runningReplicas: targets.length,
      updating: !same, liveness: health.liveness, readiness: health.readiness,
      dependenciesReady: kafka?.stable === true && kafka.memberCount === service.replicas &&
        kafka.lag !== null },
    autoscale: { project: config.stack, service: config.service, groupId: config.groupId,
      observedAt: now, lag: kafka?.lag ?? null,
      rawOffsetLag: kafka?.rawOffsetLag ?? null,
      memoryPercentMax,
      controlOnlyPartitions: kafka?.controlOnlyPartitions ?? null,
      partitions: kafka?.partitions ?? null,
      replicas: service.replicas, memberCount: kafka?.memberCount ?? null,
      groupStable: same && readyTask && kafka?.stable === true,
      ready: same && readyTask && targets.length === service.replicas &&
        healthChecks.every(item => item.liveness === 'alive' && item.readiness === true),
      identityVerified, replayVerified: releaseVerified,
      gracefulDownVerified: releaseVerified, hostReplicaLimit,
      recoveryActive: null },
  };
}

export async function tick(config, path, adapter, { apply = false, clock = Date.now,
  session = false, recoveryApply = true } = {}) {
  validateConfig(config);
  if (!session && await sessionExists(path)) throw Error('RUNNER_ACTIVE');
  return locked(path, async () => {
    const data = readState(config, JSON.parse(await readFile(path, 'utf8')));
    const now = clock();
    const observation = await collect(config, adapter, now);
    const recovery = evaluateRecovery(config.recovery, data.recovery, observation.recovery, now);
    // Level-2 recovery deliberately does not target multi-replica services. Its
    // DEGRADED/hold observation there is not an active recovery attempt; the
    // autoscaler still requires every replica to be ready and the group stable.
    observation.autoscale.recoveryActive = recovery.action === 'FORCE_UPDATE' ||
      ['UNHEALTHY', 'RECOVERING'].includes(recovery.state.status) ||
      recovery.state.circuitOpen === true || data.recovery.pending !== null;
    const autoscale = evaluateAutoscale(config.autoscale, data.autoscale, observation.autoscale, now);
    let selected = recovery.action === 'FORCE_UPDATE' ? { kind: 'RECOVERY', decision: recovery } :
      ['SCALE_UP', 'SCALE_DOWN'].includes(autoscale.action) ? { kind: 'AUTOSCALE', decision: autoscale } : null;
    if (selected?.kind === 'RECOVERY' && !recoveryApply) {
      // Broker mode grants scale only. Keep the unhealthy observation but do not
      // reserve a Level-2 attempt or silently turn a failed restart into a scale.
      recovery.state = { ...data.recovery, status: 'UNHEALTHY',
        lastObservedAt: now, taskId: observation.recovery.taskId,
        failures: config.recovery.failureThreshold };
      recovery.audit = { ...recovery.audit, action: 'HOLD', reason: 'RECOVERY_ACTUATOR_DISABLED' };
      selected = null;
    }
    if (selected && !observation.stableTopology) {
      // Never persist a reserved attempt for an action that was not attempted.
      if (recovery.action === 'FORCE_UPDATE') {
        recovery.state = data.recovery;
        recovery.audit = { ...recovery.audit, action: 'HOLD', reason: 'TOPOLOGY_CHANGED' };
      }
      if (autoscale.action !== 'HOLD') {
        autoscale.state = data.autoscale;
        autoscale.audit = { ...autoscale.audit, reason: 'TOPOLOGY_CHANGED' };
      }
      selected = null;
    }
    if (!apply) {
      if (recovery.action === 'FORCE_UPDATE') {
        recovery.state.attempts = data.recovery.attempts;
        recovery.state.failures = config.recovery.failureThreshold;
        recovery.state.status = 'UNHEALTHY';
      }
      // A dry-run must not consume the decision window or latch an action.
      if (autoscale.action !== 'HOLD') autoscale.state = data.autoscale;
    }
    data.recovery = recovery.state;
    data.autoscale = autoscale.state;
    const events = [recovery.audit, autoscale.audit].map(e => ({ ...e,
      result: apply ? e.result : 'OBSERVE_ONLY' }));
    const record = async event => {
      data.audit = [...data.audit, event].slice(-200);
      await durableSave(path, data);
    };
    for (const event of events) await record(event);
    if (!selected || !apply) return { events, selected: selected?.kind || null,
      applied: false, observedReplicas: observation.service.replicas,
      unavailable: observation.unavailable };
    const { kind, decision } = selected;
    data.pending = { kind, at: now, serviceId: observation.service.id,
      serviceVersion: observation.service.version, taskIds: observation.targets.map(t => t.taskId),
      desiredReplicas: decision.audit.desiredReplicas ?? null };
    await record({ ...decision.audit, result: 'ACTION_RESERVED' });
    try {
      const current = await adapter.discover();
      const unchanged = current.service.id === observation.service.id &&
        current.service.version === observation.service.version &&
        current.service.replicas === observation.service.replicas &&
        JSON.stringify(current.targets.map(t => t.taskId).sort()) ===
          JSON.stringify(observation.targets.map(t => t.taskId).sort());
      if (!unchanged) {
        data.pending = null;
        if (kind === 'AUTOSCALE') data.autoscale.pending = false;
        await record({ ...decision.audit, result: 'SKIPPED_TARGET_CHANGED' });
        return { events, selected: kind, applied: false, reason: 'TARGET_CHANGED' };
      }
      if (kind === 'RECOVERY') await adapter.forceUpdate();
      else await adapter.scale(decision.audit.desiredReplicas);
      const after = verifyService(config, await adapter.inspectService());
      if (after.version <= current.service.version || (kind === 'AUTOSCALE' &&
        after.replicas !== decision.audit.desiredReplicas)) throw Error('ACTUATOR_UNCONFIRMED');
      data.pending = null;
      if (kind === 'AUTOSCALE') data.autoscale.pending = false;
      await record({ ...decision.audit, at: clock(), result: 'ACCEPTED_AWAITING_READINESS' });
      return { events, selected: kind, applied: true, result: 'ACCEPTED_AWAITING_READINESS' };
    } catch {
      await record({ ...decision.audit, result: 'UNCERTAIN_OPERATOR_REVIEW' });
      throw Error('UNCERTAIN_ACTION_OPERATOR_REVIEW');
    }
  });
}

export async function metrics(config, path) {
  validateConfig(config);
  const data = readState(config, JSON.parse(await readFile(path, 'utf8')), { allowPending: true });
  const label = `{stack="${config.stack}",service="${config.service}"}`;
  const lastScale = data.audit.findLast(event => event.signal === 'kafka_lag');
  return [
    '# TYPE funnelmetry_swarm_controller_pending_action gauge',
    `funnelmetry_swarm_controller_pending_action${label} ${data.pending === null ? 0 : 1}`,
    '# TYPE funnelmetry_swarm_controller_circuit_open gauge',
    `funnelmetry_swarm_controller_circuit_open${label} ${data.recovery.circuitOpen ? 1 : 0}`,
    '# TYPE funnelmetry_swarm_controller_recovery_attempts gauge',
    `funnelmetry_swarm_controller_recovery_attempts${label} ${data.recovery.attempts.length}`,
    '# TYPE funnelmetry_swarm_controller_last_observation_seconds gauge',
    `funnelmetry_swarm_controller_last_observation_seconds${label} ${data.recovery.lastObservedAt === null ? 'NaN' : data.recovery.lastObservedAt / 1000}`,
    '# TYPE funnelmetry_swarm_controller_observed_replicas gauge',
    `funnelmetry_swarm_controller_observed_replicas${label} ${lastScale?.previousReplicas ?? 'NaN'}`,
    '# TYPE funnelmetry_swarm_controller_decided_replicas gauge',
    `funnelmetry_swarm_controller_decided_replicas${label} ${lastScale?.desiredReplicas ?? 'NaN'}`,
    '# TYPE funnelmetry_swarm_controller_observed_memory_percent gauge',
    `funnelmetry_swarm_controller_observed_memory_percent${label} ${lastScale?.observedMemoryPercent ?? 'NaN'}`,
  ].join('\n') + '\n';
}

// Operator-only read of persisted evidence. This never probes Docker/Kafka and
// deliberately marks an old HEALTHY state as STALE rather than live health.
export async function status(config, path, now = Date.now()) {
  validateConfig(config);
  if (!integer(now)) throw Error('Invalid status clock');
  const data = readState(config, JSON.parse(await readFile(path, 'utf8')), { allowPending: true });
  const fresh = (at, maxAge) => integer(at) && at <= now && now - at <= maxAge;
  const lastScale = data.audit.findLast(event => event.signal === 'kafka_lag');
  return {
    scope: { stack: config.stack, service: config.service },
    checkedAt: new Date(now).toISOString(), source: 'persisted_controller_state', liveProbe: false,
    pendingOperatorReview: data.pending !== null,
    recovery: {
      status: fresh(data.recovery.lastObservedAt, config.recovery.maxSampleAgeMs)
        ? data.recovery.status : 'STALE',
      persistedStatus: data.recovery.status,
      lastObservedAt: data.recovery.lastObservedAt,
      circuitOpen: data.recovery.circuitOpen,
      recentAttempts: data.recovery.attempts.filter(at => integer(at) && at <= now && now - at < config.recovery.windowMs).length,
    },
    autoscale: {
      observation: fresh(data.autoscale.lastObservedAt, config.autoscale.maxSampleAgeMs)
        ? 'OBSERVED' : 'STALE',
      lastObservedAt: data.autoscale.lastObservedAt,
      replicas: data.autoscale.replicas,
      pending: data.autoscale.pending,
      lastDecisionAt: data.autoscale.lastDecisionAt,
      lastReason: lastScale?.reason ?? null,
      lastResult: lastScale?.result ?? null,
    },
  };
}

export async function run(config, path, adapter, { apply = false, intervalMs = 30000,
  clock = Date.now, signal, recoveryApply = true } = {}) {
  validateConfig(config);
  if (!integer(intervalMs, 5000) || intervalMs > 600000) throw Error('Invalid runner interval');
  const sessionPath = `${path}.session`;
  await mkdir(sessionPath); // persistent lease; never steal after an unclean stop
  try {
    while (!signal?.aborted) {
      const result = await tick(config, path, adapter, { apply, clock, session: true, recoveryApply });
      console.log(JSON.stringify(result));
      try { await delay(intervalMs, undefined, { signal }); }
      catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  } finally { await rmdir(sessionPath); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, configPath, statePath, ...flags] = process.argv.slice(2);
  try {
    const intervalFlags = flags.filter(f => /^--interval-ms=[0-9]+$/.test(f));
    const applyFlags = flags.filter(f => f === '--apply');
    if (!['init', 'once', 'metrics', 'status', 'run'].includes(command) || !configPath || !statePath ||
      intervalFlags.length > 1 || applyFlags.length > 1 ||
      intervalFlags.length + applyFlags.length !== flags.length ||
      ((command === 'init' || command === 'metrics' || command === 'status') && flags.length) ||
      (command === 'once' && intervalFlags.length)) {
      throw Error('Usage: controller.mjs init|once|metrics|status|run config.json state.json [--apply] [--interval-ms=30000]');
    }
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const state = resolve(statePath);
    if (command === 'init') { await initialize(config, state); console.log('Swarm controller state initialized'); }
    else if (command === 'metrics') process.stdout.write(await metrics(config, state));
    else if (command === 'status') console.log(JSON.stringify(await status(config, state)));
    else if (command === 'once') console.log(JSON.stringify(await tick(config, state, dockerClient(config), { apply: applyFlags.length === 1 })));
    else {
      const abort = new AbortController();
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
      await run(config, state, dockerClient(config), { apply: applyFlags.length === 1,
        intervalMs: intervalFlags.length ? Number(intervalFlags[0].slice('--interval-ms='.length)) : 30000,
        signal: abort.signal });
    }
  } catch { console.error('Swarm controllers stopped safely; review config/state/lock and Docker without resetting state.'); process.exitCode = 1; }
}
