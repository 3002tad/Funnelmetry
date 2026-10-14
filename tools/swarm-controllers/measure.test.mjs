import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMeasureConfig, projectMeasure, measure } from './measure.mjs';

const example = JSON.parse(readFileSync(new URL('./config.example.json', import.meta.url), 'utf8'));
const nextImage = `ghcr.io/example/workers@sha256:${'b'.repeat(64)}`;

test('read-only image override does not edit original config or carry old release evidence', () => {
  const original = { ...example, evidence: { image: example.image,
    replayTestRef: 'replay-123', drainTestRef: 'drain-123' } };
  const snapshot = structuredClone(original);
  const prepared = prepareMeasureConfig(original, nextImage);
  assert.equal(prepared.imageOverrideUsed, true);
  assert.equal(prepared.config.image, nextImage);
  assert.equal(prepared.config.evidence, undefined);
  assert.deepEqual(original, snapshot);
  assert.throws(() => prepareMeasureConfig(original, 'workers:latest'));
});

test('measurement output is a bounded, sanitized observation, not a scale decision', () => {
  const observation = { service: { replicas: 2 }, autoscale: {
    ready: true, groupStable: true, memberCount: 2, partitions: 2, lag: '0',
    rawOffsetLag: '2', controlOnlyPartitions: 2, identityVerified: true,
    hostReplicaLimit: 4, replayVerified: false,
  }, unavailable: [] };
  const result = projectMeasure(observation, example, nextImage, 1000);
  assert.equal(result.configuredImageMatchesRuntime, false);
  assert.equal(result.consumableLag, '0');
  assert.equal(result.releaseEvidenceConfigured, false);
  assert.equal(result.source, 'live_read_only');
  assert.equal(Object.hasOwn(result, 'action'), false);
  assert.equal(Object.hasOwn(result, 'targets'), false);
});

test('measurement window rejects unbounded sample counts and intervals before probing', async () => {
  await assert.rejects(measure(example, { samples: 21 }), /Invalid bounded measurement window/);
  await assert.rejects(measure(example, { intervalMs: 0 }), /Invalid bounded measurement window/);
});
