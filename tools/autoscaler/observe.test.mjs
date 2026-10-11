import test from 'node:test';
import assert from 'node:assert/strict';
import { observe, summarizeOffsets } from './observe.mjs';
const scope = { project: 'scale-test', service: 'canonical-normalizer', groupId: 'group', topic: 'raw' };
const target = { id: 'a'.repeat(64), ...scope, oneoff: 'False', running: true, paused: false, restarting: false, startedAt: '2026-10-11' };
const reader = extra => ({ discover: async () => [target],
  identity: async () => ({ instanceId: 'normalizer-abc', clientId: 'client', mode: 'container', groupId: 'group', topic: 'raw', ready: true }),
  kafka: async () => ({ ends: [{ partition: 0, low: '0', high: '9007199254740999' }],
    commits: [{ partition: 0, offset: '9007199254740993' }], memberCount: 1, stable: true, assignments: [[0]] }), ...extra });
test('exact lag and local identity without inventing capacity/replay/drain authorization', async () => {
  const r = await observe(scope, reader(), () => 100);
  assert.equal(r.snapshot.lag, '6'); assert.equal(r.snapshot.groupStable, true);
  assert.equal(r.snapshot.identityVerified, true); assert.equal(r.snapshot.hostReplicaLimit, null);
  assert.equal(r.snapshot.replayVerified, false); assert.equal(r.snapshot.recoveryActive, null);
});
test('offset sentinel, retention gap, future offset, duplicate partition fail closed', () => {
  const end = { partition: 0, low: '5', high: '10' };
  for (const offset of ['-1', '4', '11', 5, null]) assert.equal(summarizeOffsets([end], [{ partition: 0, offset }]).lag, null);
  assert.equal(summarizeOffsets([end, end], [{ partition: 0, offset: '6' }, { partition: 0, offset: '6' }]).lag, null);
  assert.equal(summarizeOffsets([], []).lag, null);
});
test('no targets, wrong runtime scope and Docker outage stay unknown', async () => {
  assert.equal((await observe(scope, reader({ discover: async () => [] }))).reason, 'NO_TARGET');
  assert.equal((await observe(scope, reader({ identity: async () => ({ groupId: 'foreign' }) }))).reason, 'RUNTIME_BINDING_MISMATCH');
  const r = await observe(scope, reader({ kafka: async () => { throw Error('secret'); } }));
  assert.equal(r.reason, 'OBSERVATION_UNAVAILABLE'); assert.equal(JSON.stringify(r).includes('secret'), false);
});
test('replica replacement invalidates snapshot', async () => {
  let calls = 0;
  const r = await observe(scope, reader({ discover: async () => [{ ...target, startedAt: ++calls }] }));
  assert.equal(r.reason, 'TOPOLOGY_CHANGED'); assert.equal(r.snapshot.lag, null);
});
test('Kafka probe failures keep data unknown and expose only the fixed phase', async () => {
  for (const phase of ['connect', 'describe', 'offsets', 'assignments']) {
    const r = await observe(scope, reader({ kafka: async () => ({ probeFailure: phase }) }));
    assert.equal(r.reason, 'OBSERVATION_UNAVAILABLE');
    assert.equal(r.phase, `kafka-${phase}`);
    assert.equal(r.snapshot.lag, null);
    assert.equal(r.snapshot.groupStable, false);
  }
});
test('missing per-member assignment array cannot verify group stability', async () => {
  const base = reader();
  const r = await observe(scope, reader({ kafka: async () => ({ ...await base.kafka(), assignments: [0] }) }));
  assert.equal(r.snapshot.groupStable, false);
});
test('shared transactional ID and overlapping partition assignments do not verify', async () => {
  const base = reader();
  const r = await observe(scope, reader({ discover: async () => [target, { ...target, id: 'b'.repeat(64) }],
    kafka: async () => ({ ...await base.kafka(), memberCount: 2, assignments: [[0], [0]] }) }));
  assert.equal(r.snapshot.identityVerified, false); assert.equal(r.snapshot.groupStable, false);
});
