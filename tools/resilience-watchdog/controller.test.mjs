import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, tick, metrics } from './controller.mjs';

const config = { project: 'watchdog-unit', services: ['canonical-normalizer'], failureThreshold: 1,
  cooldownMs: 10, maxAttempts: 2, windowMs: 1000, maxSampleAgeMs: 10, startupGraceMs: 0,
  port: 31009, probeTimeoutMs: 100, commandTimeoutMs: 5000, restartTimeoutSec: 1 };
const target = { id: 'a'.repeat(64), project: config.project, service: config.services[0],
  running: true, oneoff: false, startedAt: 0 };
async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), 'watchdog-unit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  await initialize(config, path);
  return path;
}
const adapter = extra => ({ discover: async () => target, inspect: async () => target,
  probe: async () => ({ liveness: 'failed', readiness: false }),
  restart: async () => { throw Error('unexpected restart'); }, ...extra });

test('observe only does not consume budget or call actuator', async t => {
  const path = await sandbox(t);
  const events = await tick(config, path, adapter(), { clock: () => 20 });
  assert.equal(events[0].action, 'WOULD_RESTART');
  assert.deepEqual(JSON.parse(await readFile(path)).states[target.service].attempts, []);
});
test('intent and reservation exist on disk before action; next probe verifies health', async t => {
  const path = await sandbox(t);
  await tick(config, path, adapter({ restart: async id => {
    const state = JSON.parse(await readFile(path));
    assert.equal(id, target.id);
    assert.equal(state.pending.containerId, id);
    assert.deepEqual(state.states[target.service].attempts, [20]);
    assert.equal(state.audit.at(-1).action, 'RESTART');
  } }), { apply: true, clock: () => 20 });
  const after = JSON.parse(await readFile(path));
  assert.equal(after.pending, null);
  assert.equal(after.states[target.service].status, 'RECOVERING');
  const events = await tick(config, path, adapter({ probe: async () => ({ liveness: 'alive', readiness: true }) }), { apply: true, clock: () => 21 });
  assert.equal(events[0].status, 'HEALTHY');
});
test('actuator uncertainty latches across reload without automatic retry or raw error disclosure', async t => {
  const path = await sandbox(t);
  let calls = 0;
  const docker = adapter({ restart: async () => { calls++; throw Error('secret raw stderr'); } });
  await assert.rejects(tick(config, path, docker, { apply: true, clock: () => 20 }), /UNCERTAIN/);
  await assert.rejects(tick(config, path, docker, { apply: true, clock: () => 50 }), /UNCERTAIN/);
  assert.equal(calls, 1);
  assert.equal((await readFile(path, 'utf8')).includes('secret raw stderr'), false);
});
test('target changed/stopped before action is not restarted', async t => {
  const path = await sandbox(t);
  const events = await tick(config, path, adapter({ inspect: async () => ({ ...target, running: false }) }), { apply: true, clock: () => 20 });
  assert.equal(events.at(-1).reason, 'TARGET_CHANGED');
});
test('missing/ambiguous discovery never restarts', async t => {
  const path = await sandbox(t);
  const events = await tick(config, path, adapter({ discover: async () => null }), { apply: true, clock: () => 20 });
  assert.equal(events[0].reason, 'TARGET_NOT_ELIGIBLE');
});
test('existing state cannot initialize again and config change fails closed', async t => {
  const path = await sandbox(t);
  await assert.rejects(initialize(config, path));
  await assert.rejects(tick({ ...config, maxAttempts: 3 }, path, adapter()), /MISMATCH/);
});
test('exclusive lock prevents concurrent or stale-lock takeover', async t => {
  const path = await sandbox(t);
  await mkdir(`${path}.lock`);
  await assert.rejects(tick(config, path, adapter()), { code: 'EEXIST' });
});
test('corrupt state never bootstraps implicitly', async t => {
  const path = await sandbox(t);
  await writeFile(path, '{broken');
  await assert.rejects(tick(config, path, adapter()));
});

test('cannot persist intent => no actuator call', async t => {
  const path = await sandbox(t);
  let calls = 0;
  await assert.rejects(tick(config, path, adapter({
    discover: async () => { await rm(path); await mkdir(path); return target; },
    restart: async () => { calls++; },
  }), { apply: true, clock: () => 20 }));
  assert.equal(calls, 0);
});

test('metrics are read-only snapshots; unknown observation is not zero', async t => {
  const path = await sandbox(t);
  const before = await readFile(path, 'utf8');
  const output = await metrics(config, path, 20);
  assert.match(output, /last_observation_seconds\{[^}]+\} NaN/);
  assert.match(output, /reserved_attempts_window\{[^}]+\} 0/);
  assert.equal(await readFile(path, 'utf8'), before);
});
