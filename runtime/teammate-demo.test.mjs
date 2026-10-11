import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bundle, createBundle, validateManifest, composeArgs, exclusiveOperation } from './teammate-demo.mjs';

test('fresh bundle isolates project and credentials; manifest contains no secret', () => {
  const a = bundle(), b = bundle();
  assert.notEqual(a.manifest.project, b.manifest.project);
  assert.notEqual(a.env, b.env);
  validateManifest(a.manifest);
  for (const line of a.env.trim().split('\n').filter(l => /PASSWORD=|SECRET=/.test(l))) {
    const secret = line.split('=')[1];
    assert.ok(secret.length >= 48);
    assert.equal(JSON.stringify(a.manifest).includes(secret), false);
  }
  assert.equal(a.manifest.authoritative, false);
});
test('unsafe port/project/image manifest cannot target another deployment', () => {
  for (const port of [0, 80, 65536, NaN, '5183']) assert.throws(() => bundle(port));
  const m = bundle().manifest;
  assert.throws(() => validateManifest({ ...m, project: 'funnelmetry-demo-new' }));
  assert.throws(() => validateManifest({ ...m, images: {} }));
  const args = composeArgs('/isolated', m);
  assert.ok(!args.some(a => /live.yml|catalog.yml|observability.yml/.test(a)));
  assert.equal(args[2], m.project);
});
test('initialization never overwrites credentials or partial directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'teammate-unit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'fresh');
  await createBundle(target, 5183);
  const before = await readFile(join(target, 'demo.env'), 'utf8');
  await assert.rejects(createBundle(target, 5183), /EEXIST/);
  assert.equal(await readFile(join(target, 'demo.env'), 'utf8'), before);
});
test('generated fresh configuration passes Compose validation', { skip: !process.env.TEST_COMPOSE_EXE }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'teammate-compose-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'fresh');
  const m = await createBundle(target, 5183);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HANDOFF_|COMPOSE_)/i.test(k)));
  await promisify(execFile)(process.env.TEST_COMPOSE_EXE, [...composeArgs(target, m), 'config', '--quiet'],
    { env, timeout: 30000, windowsHide: true });
});
test('concurrent lifecycle operations are blocked; status remains readable; failure releases lease', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'teammate-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(exclusiveOperation(dir, 'watchdog', async () => {
    for (const action of ['start', 'stop', 'watchdog']) {
      await assert.rejects(exclusiveOperation(dir, action, () => assert.fail('must not execute')), /ALREADY_ACTIVE/);
    }
    assert.equal(await exclusiveOperation(dir, 'status', async () => 'read-only'), 'read-only');
    throw Error('test failure');
  }), /test failure/);
  assert.equal(await exclusiveOperation(dir, 'start', async () => 'released'), 'released');
});
