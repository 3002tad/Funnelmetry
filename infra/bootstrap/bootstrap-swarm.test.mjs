import assert from 'node:assert/strict';
import test from 'node:test';
import { schemaFiles, schemaDigest, connectWithRetry, installAnalyticalReleases } from './bootstrap-swarm.mjs';

test('Swarm bootstrap includes the traffic schemas after the core and analytical schemas', async () => {
  const files = await schemaFiles(new URL('../..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
  assert.match(files.at(-3), /traffic\/001_raw_utm_source\.sql$/);
  assert.match(files.at(-2), /traffic\/002_source_registry\.sql$/);
  assert.match(files.at(-1), /011_monitoring_credentials\.sql$/);
  assert.ok(files.some(file => file.endsWith('/v2/001_canonical_ledger.sql')));
  const baseline = files.filter(file => /\/v2\/\d{3}_.*\.sql$/.test(file));
  assert.equal(baseline.length, 20);
  assert.ok(baseline.at(-1).endsWith('/v2/020_product_reference.sql'));
  assert.ok(!files.some(file => /\/v2\/(021|022|023|024)_/.test(file)));
});

test('Swarm bootstrap readiness retry is bounded and does not run a reset', async () => {
  let count = 0;
  const createClient = () => ({ connect: async () => { if (++count < 3) throw Error('not ready'); }, end: async () => {} });
  await connectWithRetry(createClient, 3, async () => {});
  assert.equal(count, 3);
  await assert.rejects(connectWithRetry(() => ({ connect: async () => { throw Error('not ready'); }, end: async () => {} }), 2, async () => {}), /SWARM_POSTGRES_NOT_READY/);
});

test('analytical release installers execute sequentially and stop on a failed binding', async () => {
  const calls = [];
  const pool = {};
  await installAnalyticalReleases(pool, [async value => { assert.equal(value, pool); calls.push('base'); },
    async () => { calls.push('order'); }, async () => { calls.push('product'); }]);
  assert.deepEqual(calls, ['base', 'order', 'product']);
  await assert.rejects(installAnalyticalReleases(pool, [async () => { throw Error('binding mismatch'); },
    async () => { calls.push('unexpected'); }]), /binding mismatch/);
  assert.ok(!calls.includes('unexpected'));
});

test('schema digest is independent of checkout path but rejects external schema paths', () => {
  assert.equal(schemaDigest(['/checkout/infra/postgres/v2/001.sql'], ['SELECT 1'], '/checkout'),
    schemaDigest(['/workspace/infra/postgres/v2/001.sql'], ['SELECT 1']));
  assert.throws(() => schemaDigest(['/outside/001.sql'], ['SELECT 1'], '/checkout'), /outside/);
});
