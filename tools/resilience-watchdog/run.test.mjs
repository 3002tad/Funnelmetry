import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.mjs';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('./config.example.json', import.meta.url)));
const adapter = { discover: async service => ({ project: config.project, service, running: true, oneoff: false }),
  probe: async () => ({ liveness: 'alive' }) };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'watchdog-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state.json');
}
test('serial cycles stop on cancellation and release session lease', async t => {
  const path = await setup(t), stop = new AbortController(); let calls = 0;
  await run(config, path, adapter, { intervalMs: 1000, signal: stop.signal, apply: true,
    cycle: async (_c, _p, _a, opts) => { assert.equal(opts.apply, true); calls++; if (calls === 2) stop.abort(); return []; },
    sleep: async () => {} });
  assert.equal(calls, 2);
  await assert.rejects(access(`${path}.runner.lock`));
});
test('wrong health port or unhealthy startup cannot enter apply loop', async t => {
  let calls = 0;
  await assert.rejects(run(config, await setup(t), { ...adapter, probe: async () => ({ liveness: 'failed' }) },
    { intervalMs: 1000, apply: true, cycle: async () => { calls++; } }), /STARTUP_TARGET/);
  assert.equal(calls, 0);
});
test('second runner cannot overlap, and uncertain cycle does not retry', async t => {
  const path = await setup(t); let calls = 0;
  await assert.rejects(run(config, path, adapter, { intervalMs: 1000, cycle: async () => {
    calls++;
    await assert.rejects(run(config, path, adapter, { intervalMs: 1000 }), /EEXIST/);
    throw Error('UNCERTAIN');
  } }), /UNCERTAIN/);
  assert.equal(calls, 1);
});
test('open circuit terminates scheduler for operator review', async t => {
  await assert.rejects(run(config, await setup(t), adapter, { intervalMs: 1000,
    cycle: async () => [{ reason: 'CIRCUIT_OPEN_OPERATOR_REVIEW' }] }), /CIRCUIT_REQUIRES_REVIEW/);
});
