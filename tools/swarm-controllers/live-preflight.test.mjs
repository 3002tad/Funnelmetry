import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLivePreflight } from './live-preflight.mjs';

const config = JSON.parse(readFileSync(new URL('./config.example.json', import.meta.url), 'utf8'));
const evidence = { image: config.image, replayTestRef: 'reviewed-replay-123',
  drainTestRef: 'reviewed-drain-123' };
const persisted = { pendingOperatorReview: false, autoscale: { pending: false },
  recovery: { circuitOpen: false } };
const observation = { replicas: 1, ready: true, groupStable: true, memberCount: 1,
  identityVerified: true, partitions: 2, hostReplicaLimit: 3, unavailable: [],
  memoryPercentMax: 8, consumableLag: '0' };

test('live preflight reports current-image/state/security blockers without authorizing apply', () => {
  const report = evaluateLivePreflight({ config, runtimeImage: `ghcr.io/example/workers@sha256:${'b'.repeat(64)}`,
    managerReady: true, authorizationPlugins: null, persisted, observation, sessionActive: false });
  assert.equal(report.applyAuthorized, false);
  assert.equal(report.controllerImageMatchesRuntime, false);
  assert.ok(report.blockers.includes('IMAGE_DIGEST_MISMATCH'));
  assert.ok(report.blockers.includes('RELEASE_REPLAY_DRAIN_EVIDENCE_MISSING'));
  assert.ok(report.blockers.includes('RESTRICTED_DOCKER_ACTUATOR_NOT_ATTESTED'));
  assert.equal(Object.hasOwn(report, 'evidence'), false);
});

test('even a Docker authorization plugin and release evidence need separate policy attestation', () => {
  const report = evaluateLivePreflight({ config: { ...config, evidence }, runtimeImage: config.image,
    managerReady: true, authorizationPlugins: ['example'], persisted, observation, sessionActive: false });
  assert.deepEqual(report.blockers, ['RESTRICTED_DOCKER_ACTUATOR_NOT_ATTESTED']);
  assert.equal(report.authorizationPluginCount, 1);
});

test('pending action, unknown probes and insufficient capacity fail closed', () => {
  const report = evaluateLivePreflight({ config: { ...config, evidence }, runtimeImage: config.image,
    managerReady: false, authorizationPlugins: [], persisted: { ...persisted, pendingOperatorReview: true },
    observation: { ...observation, ready: false, hostReplicaLimit: 1,
      memoryPercentMax: null, unavailable: ['MEMORY_PROBE'] }, sessionActive: true });
  for (const blocker of ['SWARM_MANAGER_UNVERIFIED', 'ACTION_PENDING_REVIEW', 'RUNNER_SESSION_UNVERIFIED',
    'REPLICA_READINESS_UNVERIFIED', 'PARTITION_OR_CAPACITY_CEILING', 'LIVE_PROBE_UNAVAILABLE',
    'MEMORY_PROBE_UNAVAILABLE']) assert.ok(report.blockers.includes(blocker), blocker);
});

test('reviewed local-demo boundary clears only the demo actuator gate', () => {
  const report = evaluateLivePreflight({ config: { ...config, evidence }, runtimeImage: config.image,
    managerReady: true, authorizationPlugins: [], persisted, observation, sessionActive: false,
    localDemoBoundaryAttested: true });
  assert.deepEqual(report.blockers, []);
  assert.equal(report.applyAuthorized, true);
  assert.equal(report.authorizationScope, 'LOCAL_DOCKER_DESKTOP_DEMO');
});
