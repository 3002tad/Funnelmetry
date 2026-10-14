import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityLimit, kafkaSummary, verifyService } from './docker.mjs';

const scope = { stack: 'funnelmetry-live-test', service: 'canonical-normalizer',
  image: `example/workers@sha256:${'a'.repeat(64)}`, groupId: 'normalizer-v1', topic: 'raw.v1' };
const service = { ID: 'service-id', Version: { Index: 3 }, Spec: {
  Name: `${scope.stack}_${scope.service}`, Labels: { 'com.docker.stack.namespace': scope.stack },
  Mode: { Replicated: { Replicas: 1 } }, TaskTemplate: { ContainerSpec: { Image: scope.image },
    Resources: { Reservations: { NanoCPUs: 100000000, MemoryBytes: 134217728 } } },
} };

test('exact stack, digest and replicated service required', () => {
  assert.equal(verifyService(scope, service).replicas, 1);
  for (const altered of [
    { ...service, Spec: { ...service.Spec, Name: 'foreign_canonical-normalizer' } },
    { ...service, Spec: { ...service.Spec, Mode: { Global: {} } } },
    { ...service, Spec: { ...service.Spec, TaskTemplate: { ContainerSpec: { Image: 'workers:latest' } } } },
  ]) assert.throws(() => verifyService(scope, altered));
});

test('capacity is reserved-resource bound and unknown fails closed', () => {
  const c = { nodeCpu: 4e9, nodeMem: 4 * 1024 ** 3, usedCpu: 3e9,
    usedMem: 3 * 1024 ** 3, cpuPerReplica: 5e8, memPerReplica: 512 * 1024 ** 2,
    currentReplicas: 1 };
  assert.equal(capacityLimit(c, 5e8, 512 * 1024 ** 2), 2);
  assert.equal(capacityLimit(null, 5e8, 512 * 1024 ** 2), null);
  assert.equal(capacityLimit(c, undefined, 0), null);
});

test('Kafka lag does not interpret unknown offsets as zero', () => {
  const probe = { ends: [{ partition: 0, low: '0', high: '5' }],
    commits: [{ partition: 0, offset: '-1' }], memberCount: 1, stable: true, assignments: [[0]] };
  assert.equal(kafkaSummary(probe).lag, null);
  assert.equal(kafkaSummary({ probeFailure: 'connect' }), null);
});
test('Kafka summary distinguishes verified control tail from raw offset delta', () => {
  const probe = { ends: [{ partition: 0, low: '0', high: '8' }],
    commits: [{ partition: 0, offset: '7' }], memberCount: 1, stable: true, assignments: [[0]],
    tails: [{ partition: 0, fetchOffset: '7', highWatermark: '8', lastStableOffset: '8',
      errorCode: 0, messages: [{ offset: '7', control: true }] }] };
  assert.equal(kafkaSummary(probe).lag, '0');
  assert.equal(kafkaSummary(probe).rawOffsetLag, '1');
  assert.equal(kafkaSummary({ ...probe, tails: [] }).lag, '1');
});
