import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSwarmReadiness, requiredTopics, SwarmSchemaMismatch, waitForSwarmReadiness } from './swarm-readiness.mjs';
import { topicSpecs } from './swarm-kafka-topics.mjs';

test('readiness topic set matches the isolated Kafka bootstrap contract', () => {
  assert.deepEqual(requiredTopics, topicSpecs('1').map(item => item.topic));
});

test('readiness requires completed schema, releases and all topics', async () => {
  const query = async sql => ({ rows: sql.includes('handoff_bootstrap')
    ? [{ status: 'READY', schema_digest: 'known' }] : [{ completed_at: new Date() }] });
  const topics = async () => ({ topics: requiredTopics.map(name => ({ name, partitions: [{}] })) });
  assert.equal(await inspectSwarmReadiness({ query, topics }, 'known'), true);
  assert.equal(await inspectSwarmReadiness({ query, topics: async () => ({ topics: [] }) }, 'known'), false);
  await assert.rejects(inspectSwarmReadiness({ query, topics }, 'other'), SwarmSchemaMismatch);
});

test('bounded startup retries transient dependency failure but never retries schema mismatch', async () => {
  let calls = 0;
  await waitForSwarmReadiness({ SWARM_READY_MAX_ATTEMPTS: '3' }, async () => ++calls === 3, async () => {});
  assert.equal(calls, 3);
  await assert.rejects(waitForSwarmReadiness({ SWARM_READY_MAX_ATTEMPTS: '2' },
    async () => { throw new SwarmSchemaMismatch('mismatch'); }, async () => {}), SwarmSchemaMismatch);
});
