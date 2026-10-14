import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSwarmApp, validateSwarmCandidate } from './swarm-preflight.mjs';

const digest = 'a'.repeat(64);
const candidate = {
  HANDOFF_PROJECT: 'funnelmetry-unified',
  SWARM_STACK_NAME: 'funnelmetry-swarm-sandbox',
  SWARM_MIGRATION_MODE: 'OFFLINE_DEMO',
  SWARM_API_IMAGE: `ghcr.io/3002tad/funnelmetry/api@sha256:${digest}`,
  SWARM_WEB_IMAGE: `ghcr.io/3002tad/funnelmetry/web@sha256:${digest}`,
  SWARM_WORKERS_IMAGE: `ghcr.io/3002tad/funnelmetry/workers@sha256:${digest}`,
  SWARM_POSTGRES_IMAGE: `postgres:15-alpine@sha256:${digest}`,
  SWARM_KAFKA_IMAGE: `apache/kafka:3.9.1@sha256:${digest}`,
  HANDOFF_DB_PASSWORD: 'private-value-never-in-report',
};

test('fresh candidate is planning only and does not echo secrets', () => {
  const plan = validateSwarmCandidate(candidate);
  assert.equal(plan.status, 'PLANNING_ONLY');
  assert.equal(plan.mode, 'OFFLINE_DEMO');
  assert.ok(plan.unverified.includes('REPLAY_AND_CUTOVER'));
  assert.doesNotMatch(JSON.stringify(plan), /private-value-never-in-report/);
});

test('a full Git SHA image tag is also an accepted versioned reference', () => {
  const plan = validateSwarmCandidate({ ...candidate,
    SWARM_API_IMAGE: `ghcr.io/3002tad/funnelmetry/api:sha-${'b'.repeat(40)}` });
  assert.equal(plan.status, 'PLANNING_ONLY');
});

test('candidate cannot share the Compose project identity or claim live cutover', () => {
  assert.throws(() => validateSwarmCandidate({ ...candidate, SWARM_STACK_NAME: candidate.HANDOFF_PROJECT }), /different names/);
  assert.throws(() => validateSwarmCandidate({ ...candidate, SWARM_STACK_NAME: '../outside' }), /SWARM_STACK_NAME/);
  assert.throws(() => validateSwarmCandidate({ ...candidate, SWARM_MIGRATION_MODE: 'MIGRATION_CUTOVER' }), /OFFLINE_DEMO/);
});

test('multi-partition Raw requires per-container Normalizer identity in a new Swarm stack', () => {
  assert.throws(() => validateSwarmCandidate({ ...candidate, HANDOFF_RAW_PARTITIONS: '2' }), /SWARM_NORMALIZER_ID_MODE=container/);
  assert.equal(validateSwarmCandidate({ ...candidate, HANDOFF_RAW_PARTITIONS: '2',
    SWARM_NORMALIZER_ID_MODE: 'container' }).status, 'PLANNING_ONLY');
  assert.throws(() => validateSwarmCandidate({ ...candidate, HANDOFF_RAW_PARTITIONS: '0' }), /HANDOFF_RAW_PARTITIONS/);
  assert.throws(() => validateSwarmCandidate({ ...candidate, HANDOFF_RAW_PARTITIONS: '65',
    SWARM_NORMALIZER_ID_MODE: 'container' }), /HANDOFF_RAW_PARTITIONS/);
  assert.throws(() => validateSwarmCandidate({ ...candidate, SWARM_NORMALIZER_ID_MODE: 'auto' }), /SWARM_NORMALIZER_ID_MODE/);
});

test('fresh parallel-live candidate requires isolated connector, observed feed and credentials', () => {
  const live = { ...candidate, SWARM_MIGRATION_MODE: 'PARALLEL_LIVE',
    SWARM_LIVE_ACK: 'FRESH_PARALLEL_LIVE', SWARM_CONNECTOR_ID: 'fresh-live-source',
    HANDOFF_CONNECTOR_ID: 'old-source', SWARM_FEED_URL: 'https://feed.example.com/v1/events',
    SWARM_FEED_ID: '5143bee7-b883-453f-a045-e696621dbd1d', SWARM_INITIAL_AFTER_SEQ: '0',
    HANDOFF_FEED_TOKEN: 'secret-feed', HANDOFF_CATALOG_KEY: 'secret-catalog',
    HANDOFF_DASHSCOPE_API_KEY: 'secret-ai', SWARM_CATALOG_URL: 'https://store.example.com/',
    SWARM_DASHSCOPE_BASE_URL: 'https://ai.example.com/v1' };
  const plan = validateSwarmCandidate(live);
  assert.equal(plan.mode, 'PARALLEL_LIVE');
  assert.doesNotMatch(JSON.stringify(plan), /secret-/);
  assert.throws(() => validateSwarmCandidate({ ...live, SWARM_CONNECTOR_ID: 'old-source' }), /unique/);
  assert.throws(() => validateSwarmCandidate({ ...live, SWARM_INITIAL_AFTER_SEQ: '-1' }), /nonnegative/);
  assert.throws(() => validateSwarmCandidate({ ...live, SWARM_FEED_URL: 'http://feed.example.com/' }), /HTTPS/);
  assert.throws(() => validateSwarmCandidate({ ...live, SWARM_MONITORING_ENABLED: 'maybe' }), /SWARM_MONITORING_ENABLED/);
  assert.throws(() => validateSwarmCandidate({ ...live, SWARM_MONITORING_ENABLED: 'true',
    MONITORING_PROMETHEUS_IMAGE: 'prom/prometheus:latest' }), /MONITORING_PROMETHEUS_IMAGE/);
});

test('application images require GHCR full Git SHA tags or immutable digests', () => {
  for (const key of ['SWARM_API_IMAGE', 'SWARM_WEB_IMAGE', 'SWARM_WORKERS_IMAGE']) {
    for (const ref of ['', 'ghcr.io/3002tad/funnelmetry/api:latest',
      'ghcr.io/3002tad/funnelmetry/api:sha-deadbeef', 'docker.io/example/api@sha256:' + digest]) {
      assert.throws(() => validateSwarmCandidate({ ...candidate, [key]: ref }), new RegExp(key));
    }
  }
});

test('stateful images require tagged official references with digests', () => {
  for (const key of ['SWARM_POSTGRES_IMAGE', 'SWARM_KAFKA_IMAGE']) {
    for (const ref of ['', 'postgres:15-alpine', 'apache/kafka:latest',
      'example.com/postgres:15-alpine@sha256:' + digest]) {
      assert.throws(() => validateSwarmCandidate({ ...candidate, [key]: ref }), new RegExp(key));
    }
  }
});

test('HTTPS application requires a hostname, pinned Traefik and admin identity', () => {
  const app = { SWARM_TLS_MODE: 'local', SWARM_PUBLIC_DOMAIN: 'funnelmetry.local',
    SWARM_TRAEFIK_IMAGE: `traefik:v3.6.0@sha256:${digest}`, SWARM_ADMIN_EMAIL: 'admin@example.com' };
  assert.equal(validateSwarmApp(app).domain, 'funnelmetry.local');
  for (const domain of ['', 'localhost', '127.0.0.1', 'HTTPS://demo.example.com', 'demo.example.com:443']) {
    assert.throws(() => validateSwarmApp({ ...app, SWARM_PUBLIC_DOMAIN: domain }), /SWARM_PUBLIC_DOMAIN/);
  }
  assert.throws(() => validateSwarmApp({ ...app, SWARM_TRAEFIK_IMAGE: 'traefik:latest' }), /SWARM_TRAEFIK_IMAGE/);
  assert.throws(() => validateSwarmApp({ ...app, SWARM_ADMIN_EMAIL: '' }), /SWARM_ADMIN_EMAIL/);
  assert.throws(() => validateSwarmApp({ ...app, SWARM_TLS_MODE: 'acme' }), /ACME/);
  assert.equal(validateSwarmApp({ ...app, SWARM_TLS_MODE: 'acme',
    SWARM_PUBLIC_DOMAIN: 'demo.example.com', SWARM_ACME_EMAIL: 'ops@example.com' }).tlsMode, 'acme');
});
