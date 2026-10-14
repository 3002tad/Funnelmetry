import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { KAFKA_PROBE, observe, summarizeOffsets } from './observe.mjs';
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
test('only an exact read_committed control-only tail removes transactional marker lag', () => {
  const ends = [{ partition: 0, low: '0', high: '101' }, { partition: 1, low: '0', high: '51' }];
  const commits = [{ partition: 0, offset: '100' }, { partition: 1, offset: '50' }];
  const tails = ends.map((end, partition) => ({ partition, fetchOffset: commits[partition].offset,
    highWatermark: end.high, lastStableOffset: end.high, errorCode: 0,
    messages: [{ offset: commits[partition].offset, control: true }] }));
  assert.deepEqual(summarizeOffsets(ends, commits, tails), {
    lag: '0', rawOffsetLag: '2', partitions: 2, controlOnlyPartitions: 2,
  });
  assert.equal(summarizeOffsets(ends, commits).lag, '2');
  assert.equal(summarizeOffsets(ends, commits, tails.slice(0, 1)).lag, '1');
  for (const changed of [
    { ...tails[0], messages: [{ offset: '100', control: false }] },
    { ...tails[0], messages: [] },
    { ...tails[0], lastStableOffset: '100' },
    { ...tails[0], highWatermark: '102' },
    { ...tails[0], fetchOffset: '99' },
    { ...tails[0], errorCode: 1 },
  ]) assert.equal(summarizeOffsets(ends, commits, [changed, tails[1]]).lag, '1');
  assert.equal(summarizeOffsets(ends, commits, [tails[0], tails[0], tails[1]]).lag, '1');
});
test('control-marker evidence must cover every offset in order and is bounded', () => {
  const end = { partition: 0, low: '0', high: '12' }, commit = { partition: 0, offset: '10' };
  const base = { partition: 0, fetchOffset: '10', highWatermark: '12', lastStableOffset: '12',
    errorCode: 0, messages: [{ offset: '10', control: true }, { offset: '11', control: true }] };
  assert.equal(summarizeOffsets([end], [commit], [base]).lag, '0');
  assert.equal(summarizeOffsets([end], [commit], [{ ...base, messages: [base.messages[1], base.messages[0]] }]).lag, '2');
  assert.equal(summarizeOffsets([{ ...end, high: '27' }], [commit], [{ ...base, highWatermark: '27',
    lastStableOffset: '27', messages: Array.from({ length: 17 }, (_, index) =>
      ({ offset: String(10 + index), control: true })) }]).lag, '17');
});
test('embedded Worker probe remains valid module source', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'],
    { input: KAFKA_PROBE, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
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
