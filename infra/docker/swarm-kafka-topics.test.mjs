import assert from 'node:assert/strict';
import test from 'node:test';
import { topicSpecs, ensureTopics } from './swarm-kafka-topics.mjs';

test('Swarm topics preserve the raw partition setting and compacted receipt topics', () => {
  const specs = topicSpecs('3');
  assert.equal(specs[0].numPartitions, 3);
  assert.equal(specs.find(item => item.topic === 'funnelmetry.ingress.receipts.v1').configEntries[0].value, 'compact');
  assert.throws(() => topicSpecs('0'), /Invalid/);
  assert.throws(() => topicSpecs('2.5'), /Invalid/);
});

test('a mismatched existing topic is rejected before creating any other topic', async () => {
  let creates = 0;
  const admin = { listTopics: async () => ['funnelmetry.raw.v1'],
    fetchTopicMetadata: async () => ({ topics: [{ name: 'funnelmetry.raw.v1', partitions: [{ replicas: [1] }] }] }),
    describeConfigs: async () => ({ resources: [{ resourceName: 'funnelmetry.raw.v1', errorCode: 0,
      configEntries: [{ configName: 'cleanup.policy', configValue: 'delete' }] }] }),
    createTopics: async () => { creates++; } };
  await assert.rejects(ensureTopics(admin, topicSpecs('2')), /layout mismatch/);
  assert.equal(creates, 0);
});

test('missing topics are created and their partition counts verified', async () => {
  const specs = topicSpecs('1');
  let created = [];
  const admin = { listTopics: async () => [],
    createTopics: async ({ topics }) => { created = topics; },
    fetchTopicMetadata: async () => ({ topics: created.map(item => ({ name: item.topic,
      partitions: Array(item.numPartitions).fill({ replicas: [1] }) })) }),
    describeConfigs: async () => ({ resources: created.map(item => ({ resourceName: item.topic,
      errorCode: 0, configEntries: [{ configName: 'cleanup.policy', configValue: item.configEntries[0].value }] })) }) };
  await ensureTopics(admin, specs);
  assert.equal(created.length, specs.length);
});
