import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, metrics, run, tick, validateConfig } from './controller.mjs';

const image = `example/workers@sha256:${'a'.repeat(64)}`;
const config = { stack: 'funnelmetry-live-test', service: 'canonical-normalizer', image,
  groupId: 'normalizer-v1', topic: 'raw.v1', cpuHeadroomNano: 100000000,
  memoryHeadroomBytes: 128 * 1024 ** 2,
  evidence: { image, replayTestRef: 'replay-fixture-123', drainTestRef: 'drain-fixture-123' },
  autoscale: { project: 'funnelmetry-live-test', service: 'canonical-normalizer',
    groupId: 'normalizer-v1', minReplicas: 1, maxReplicas: 2, upLag: '10', downLag: '0',
    upWindowMs: 10, downWindowMs: 30, cooldownMs: 100, maxSampleAgeMs: 10,
    maxGapMs: 50, minSamples: 2 },
  recovery: { service: 'canonical-normalizer', failureThreshold: 2, cooldownMs: 100,
    windowMs: 500, maxAttempts: 2, startupGraceMs: 10, maxSampleAgeMs: 10 },
};

function adapter({ ready = true, partitions = 2, failForce = false } = {}) {
  let version = 1, replicas = 1, settledReplicas = 1, scales = 0, updates = 0, lag = 100;
  const tasks = Array.from({ length: 2 }, (_, i) => ({ id: String(i + 1).repeat(64),
    taskId: String(i + 1).repeat(25), startedAt: 0,
    service: `${config.stack}_${config.service}`, running: true, health: null }));
  const service = () => ({ id: 'service-id', name: `${config.stack}_${config.service}`,
    version, replicas, reservation: { NanoCPUs: 100000000, MemoryBytes: 134217728 } });
  return {
    get scales() { return scales; }, get updates() { return updates; },
    setReady(value) { ready = value; },
    settle() { settledReplicas = replicas; },
    setLag(value) { lag = value; },
    async discover() { return { service: service(), targets: tasks.slice(0, settledReplicas) }; },
    async health() { return { liveness: 'alive', readiness: ready }; },
    async kafka() { return { ends: Array.from({ length: partitions }, (_, partition) =>
      ({ partition, high: String(partition === 0 ? lag : 0), low: '0' })),
    commits: Array.from({ length: partitions }, (_, partition) => ({ partition, offset: '0' })),
    memberCount: settledReplicas, stable: true, assignments: Array.from({ length: settledReplicas }, (_, member) =>
      Array.from({ length: partitions }, (_, i) => i).filter(i => i % settledReplicas === member)) }; },
    async identity(task) { return { instanceId: `worker-${task.taskId}`, clientId: 'client',
      groupId: config.groupId, topic: config.topic, mode: 'container' }; },
    async capacity() { return { nodeCpu: 4e9, nodeMem: 4 * 1024 ** 3,
      usedCpu: 1e9, usedMem: 1 * 1024 ** 3, cpuPerReplica: 100000000,
      memPerReplica: 134217728, currentReplicas: replicas }; },
    async scale(n) { replicas = n; version++; scales++; },
    async forceUpdate() { if (failForce) throw Error('simulated timeout'); version++; updates++; },
    async inspectService() { return { ID: 'service-id', Version: { Index: version }, Spec: {
      Name: `${config.stack}_${config.service}`,
      Labels: { 'com.docker.stack.namespace': config.stack },
      Mode: { Replicated: { Replicas: replicas } },
      TaskTemplate: { ContainerSpec: { Image: config.image }, Resources: { Reservations: service().reservation } },
    } }; },
  };
}

async function withState(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'funnelmetry-swarm-controller-'));
  const file = join(dir, 'state.json');
  try { await initialize(config, file); await fn(file); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('autoscale needs sustained lag and respects partition ceiling', async () => withState(async file => {
  const a = adapter({ partitions: 1 });
  await tick(config, file, a, { apply: true, clock: () => 100 });
  const blocked = await tick(config, file, a, { apply: true, clock: () => 120 });
  assert.equal(blocked.applied, false);
  assert.equal(a.scales, 0);
}));

test('scaling is opt-in, bounded and accepted only after service version changes', async () => withState(async file => {
  const a = adapter();
  await tick(config, file, a, { apply: false, clock: () => 100 });
  const proposed = await tick(config, file, a, { apply: false, clock: () => 120 });
  assert.equal(proposed.selected, 'AUTOSCALE');
  assert.equal(a.scales, 0);
  const applied = await tick(config, file, a, { apply: true, clock: () => 140 });
  assert.equal(applied.applied, true);
  assert.equal(a.scales, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).pending, null);
}));

test('isolated fixture converges 1→2→1 without treating multi-replica Level-2 hold as active recovery', async () => withState(async file => {
  const a = adapter();
  assert.equal((await tick(config, file, a, { apply: true, clock: () => 100 })).applied, false);
  const up = await tick(config, file, a, { apply: true, clock: () => 120 });
  assert.equal(up.selected, 'AUTOSCALE');
  assert.equal(up.result, 'ACCEPTED_AWAITING_READINESS');
  assert.equal(a.scales, 1);
  const waitingUp = await tick(config, file, a, { apply: true, clock: () => 140 });
  assert.equal(waitingUp.applied, false);
  assert.equal(waitingUp.events[1].reason, 'UNKNOWN_WORKLOAD_OR_CAPACITY');
  a.settle();
  const settled = await tick(config, file, a, { apply: true, clock: () => 160 });
  assert.equal(settled.observedReplicas, 2);
  assert.equal(settled.events[0].reason, 'SWARM_RECONCILING_OR_TARGET_UNVERIFIED');
  a.setLag(1);
  const nonzero = await tick(config, file, a, { apply: true, clock: () => 240 });
  assert.equal(nonzero.events[1].reason, 'HYSTERESIS_BAND');
  assert.equal(a.scales, 1);
  a.setLag(0);
  for (const at of [260, 280]) {
    assert.equal((await tick(config, file, a, { apply: true, clock: () => at })).applied, false);
  }
  const down = await tick(config, file, a, { apply: true, clock: () => 290 });
  assert.equal(down.selected, 'AUTOSCALE');
  assert.equal(down.result, 'ACCEPTED_AWAITING_READINESS');
  assert.equal(a.scales, 2);
  const waitingDown = await tick(config, file, a, { apply: true, clock: () => 310 });
  assert.equal(waitingDown.applied, false);
  a.settle();
  const restored = await tick(config, file, a, { apply: true, clock: () => 330 });
  assert.equal(restored.observedReplicas, 1);
  assert.equal(restored.events[0].reason, 'LIVE_AND_READY');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).pending, null);
}));

test('Level-2 only updates persistently not-ready application; uncertain action latches', async () => withState(async file => {
  const a = adapter({ ready: false, failForce: true });
  await tick(config, file, a, { apply: true, clock: () => 100 });
  await assert.rejects(tick(config, file, a, { apply: true, clock: () => 120 }), /UNCERTAIN_ACTION_OPERATOR_REVIEW/);
  assert.notEqual(JSON.parse(await readFile(file, 'utf8')).pending, null);
  assert.match(await metrics(config, file), /funnelmetry_swarm_controller_pending_action\{[^}]+\} 1/);
  await assert.rejects(tick(config, file, a, { apply: true, clock: () => 140 }), /UNCERTAIN_ACTION_OPERATOR_REVIEW/);
}));

test('accepted Level-2 update is not called healthy until a later ready probe', async () => withState(async file => {
  const a = adapter({ ready: false });
  await tick(config, file, a, { apply: true, clock: () => 100 });
  const accepted = await tick(config, file, a, { apply: true, clock: () => 120 });
  assert.equal(accepted.result, 'ACCEPTED_AWAITING_READINESS');
  assert.equal(a.updates, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).recovery.status, 'RECOVERING');
  a.setReady(true);
  const verified = await tick(config, file, a, { apply: true, clock: () => 140 });
  assert.equal(verified.events[0].reason, 'LIVE_AND_READY');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).recovery.status, 'HEALTHY');
  assert.equal(a.updates, 1);
}));

test('foreground runner holds a session lease and exits on cancellation', async () => withState(async file => {
  const abort = new AbortController();
  const a = adapter({ partitions: 1 });
  const runner = run(config, file, a, { intervalMs: 5000, signal: abort.signal,
    clock: () => { abort.abort(); return 100; } });
  await runner;
  assert.equal((await tick(config, file, a, { clock: () => 120 })).applied, false);
}));

test('missing release-specific evidence forbids scale, foreign scope is invalid', async () => {
  validateConfig({ ...config, evidence: undefined });
  assert.throws(() => validateConfig({ ...config, stack: 'other' }));
  assert.throws(() => validateConfig({ ...config, image: 'workers:latest' }));
});
