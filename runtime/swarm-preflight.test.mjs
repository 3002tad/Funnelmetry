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
