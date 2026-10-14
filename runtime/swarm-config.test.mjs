import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSwarmEnv } from './swarm-config.mjs';

test('existing ignored env maps only required legacy inputs to Swarm names', () => {
  const source = {
    HANDOFF_RAW_PARTITIONS: '2', HANDOFF_FEED_TOKEN: 'old-feed-secret',
    HANDOFF_CATALOG_KEY: 'old-catalog-secret', HANDOFF_DASHSCOPE_API_KEY: 'old-ai-secret',
  };
  const normalized = normalizeSwarmEnv(source);
  assert.equal(normalized.SWARM_RAW_PARTITIONS, '2');
  assert.equal(normalized.SWARM_FEED_TOKEN, 'old-feed-secret');
  assert.equal(normalized.SWARM_CATALOG_KEY, 'old-catalog-secret');
  assert.equal(normalized.SWARM_DASHSCOPE_API_KEY, 'old-ai-secret');
  assert.equal(source.SWARM_FEED_TOKEN, undefined);
});

test('conflicting old and new settings fail without exposing either value', () => {
  for (const [current, legacy] of [
    ['SWARM_RAW_PARTITIONS', 'HANDOFF_RAW_PARTITIONS'],
    ['SWARM_FEED_TOKEN', 'HANDOFF_FEED_TOKEN'],
    ['SWARM_CATALOG_KEY', 'HANDOFF_CATALOG_KEY'],
    ['SWARM_DASHSCOPE_API_KEY', 'HANDOFF_DASHSCOPE_API_KEY'],
  ]) {
    assert.throws(() => normalizeSwarmEnv({ [current]: 'new-secret', [legacy]: 'old-secret' }), error =>
      error.message.includes(current) && error.message.includes(legacy) &&
      !error.message.includes('new-secret') && !error.message.includes('old-secret'));
  }
});
